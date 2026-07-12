"""Fixed anaesthesia equipment store with per-case reservations.

The catalog is deliberately static — a demo theatre's shelf of common
anaesthesia equipment, defined in code so every deployment starts from the
same stock. What persists is only the reservation ledger: which case holds
how many of which item, assigned by whom. It lives in a subdirectory of the
case out-dir (``<out_dir>/_equipment/reservations.json``) so the case store's
``*.json`` glob never mistakes it for a case, and writes are atomic exactly
like ``CaseStore``'s (temp file + rename behind one process-wide lock).
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel, Field


class EquipmentItem(BaseModel):
    """One catalog entry; ``total`` is the fixed shelf stock."""

    item_id: str
    name: str
    category: str
    total: int


class Reservation(BaseModel):
    """A quantity of one item assigned to a case."""

    item_id: str
    case_id: str
    qty: int
    by: str
    at: datetime


class StockLevel(BaseModel):
    """Catalog entry joined with its live availability."""

    item_id: str
    name: str
    category: str
    total: int
    reserved: int
    available: int
    reservations: list[Reservation] = Field(default_factory=list)


#: The fixed shelf. Common anaesthesia equipment, grouped the way an
#: anaesthetic room is: airway, vascular access, regional, infusion,
#: monitoring. Quantities are small on purpose so "out of stock" is reachable
#: in a demo.
CATALOG: list[EquipmentItem] = [
    EquipmentItem(item_id="ett-6.5", name="Endotracheal tube 6.5 mm", category="airway", total=12),
    EquipmentItem(item_id="ett-7.0", name="Endotracheal tube 7.0 mm", category="airway", total=12),
    EquipmentItem(item_id="ett-7.5", name="Endotracheal tube 7.5 mm", category="airway", total=12),
    EquipmentItem(item_id="lma-3", name="Laryngeal mask airway size 3", category="airway", total=8),
    EquipmentItem(item_id="lma-4", name="Laryngeal mask airway size 4", category="airway", total=8),
    EquipmentItem(item_id="mac-blade-3", name="Macintosh laryngoscope blade 3", category="airway", total=6),
    EquipmentItem(item_id="mac-blade-4", name="Macintosh laryngoscope blade 4", category="airway", total=6),
    EquipmentItem(item_id="video-laryngoscope", name="Video laryngoscope", category="airway", total=2),
    EquipmentItem(item_id="bougie", name="Tracheal tube introducer (bougie)", category="airway", total=6),
    EquipmentItem(item_id="iv-18g", name="IV cannula 18G", category="vascular access", total=30),
    EquipmentItem(item_id="iv-20g", name="IV cannula 20G", category="vascular access", total=30),
    EquipmentItem(item_id="art-line-kit", name="Arterial line kit (20G radial)", category="vascular access", total=6),
    EquipmentItem(item_id="cvc-kit", name="Central venous catheter kit", category="vascular access", total=4),
    EquipmentItem(item_id="spinal-25g", name="Spinal needle 25G pencil-point", category="regional", total=10),
    EquipmentItem(item_id="epidural-kit", name="Epidural kit 18G Tuohy", category="regional", total=6),
    EquipmentItem(item_id="nerve-block-tray", name="Peripheral nerve block tray", category="regional", total=4),
    EquipmentItem(item_id="syringe-pump", name="Syringe pump (TIVA)", category="infusion", total=4),
    EquipmentItem(item_id="fluid-warmer", name="Fluid warmer", category="infusion", total=3),
    EquipmentItem(item_id="pressure-bag", name="Pressure infusion bag", category="infusion", total=6),
    EquipmentItem(item_id="bis-monitor", name="Depth-of-anaesthesia (BIS) monitor", category="monitoring", total=2),
    EquipmentItem(item_id="nerve-stimulator", name="Peripheral nerve stimulator", category="monitoring", total=3),
    EquipmentItem(item_id="warming-blanket", name="Forced-air warming blanket", category="monitoring", total=8),
]

CATALOG_BY_ID: dict[str, EquipmentItem] = {i.item_id: i for i in CATALOG}

# Mirrors periop.store: one process-wide lock — every EquipmentStore wraps
# the same file, so instance locks would serialize nothing.
_WRITE_LOCK = threading.Lock()


class EquipmentStore:
    """Reservation ledger over the fixed :data:`CATALOG`."""

    def __init__(self, out_dir: Path | str) -> None:
        self.path = Path(out_dir) / "_equipment" / "reservations.json"

    # ---- ledger I/O --------------------------------------------------------

    def _load(self) -> list[Reservation]:
        if not self.path.exists():
            return []
        raw = json.loads(self.path.read_text())
        return [Reservation.model_validate(r) for r in raw.get("reservations", [])]

    def _save(self, reservations: list[Reservation]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(f".{self.path.name}.{threading.get_ident()}.tmp")
        payload = {
            "reservations": [json.loads(r.model_dump_json()) for r in reservations]
        }
        try:
            tmp.write_text(json.dumps(payload, indent=2) + "\n")
            os.replace(tmp, self.path)
        finally:
            tmp.unlink(missing_ok=True)

    # ---- queries -----------------------------------------------------------

    def stock_levels(self) -> list[StockLevel]:
        reservations = self._load()
        levels = []
        for item in CATALOG:
            held = [r for r in reservations if r.item_id == item.item_id]
            reserved = sum(r.qty for r in held)
            levels.append(
                StockLevel(
                    **item.model_dump(),
                    reserved=reserved,
                    available=item.total - reserved,
                    reservations=held,
                )
            )
        return levels

    def case_reservations(self, case_id: str) -> list[Reservation]:
        return [r for r in self._load() if r.case_id == case_id]

    # ---- mutations ---------------------------------------------------------

    def reserve(self, item_id: str, case_id: str, qty: int, by: str) -> Reservation:
        """Assign ``qty`` of an item to a case; raises when stock is short."""
        item = CATALOG_BY_ID.get(item_id)
        if item is None:
            raise KeyError(f"no such equipment item: {item_id}")
        if qty < 1:
            raise ValueError("quantity must be at least 1")
        with _WRITE_LOCK:
            reservations = self._load()
            reserved = sum(r.qty for r in reservations if r.item_id == item_id)
            available = item.total - reserved
            if qty > available:
                raise ValueError(
                    f"only {available} of {item.name} available "
                    f"({reserved} of {item.total} already assigned)"
                )
            reservation = Reservation(
                item_id=item_id,
                case_id=case_id,
                qty=qty,
                by=by,
                at=datetime.now(timezone.utc),
            )
            reservations.append(reservation)
            self._save(reservations)
        return reservation

    def release(self, item_id: str, case_id: str, qty: int | None = None) -> int:
        """Return a case's hold on an item to the shelf.

        ``qty=None`` releases the case's whole hold; otherwise up to ``qty``
        units come off the case's reservations (newest first). Returns the
        number of units actually released.
        """
        if CATALOG_BY_ID.get(item_id) is None:
            raise KeyError(f"no such equipment item: {item_id}")
        with _WRITE_LOCK:
            reservations = self._load()
            kept: list[Reservation] = []
            released = 0
            remaining = qty
            for r in reversed(reservations):
                if r.item_id != item_id or r.case_id != case_id or remaining == 0:
                    kept.append(r)
                    continue
                if remaining is None or r.qty <= remaining:
                    released += r.qty
                    if remaining is not None:
                        remaining -= r.qty
                else:
                    r = r.model_copy(update={"qty": r.qty - remaining})
                    released += remaining
                    remaining = 0
                    kept.append(r)
            if released:
                self._save(list(reversed(kept)))
        return released
