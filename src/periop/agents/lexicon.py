"""Anesthesia lexicon for ASR word boosting (spec §3.4, §6).

Drug and technique terms an anesthetist dictates that generic ASR mangles.
Used as the boost list on the streaming Parakeet path and as the keyword set
for the clinical-term KER metric.
"""

ANESTHESIA_LEXICON = [
    # induction / sedation
    "propofol", "etomidate", "ketamine", "midazolam", "thiopentone", "dexmedetomidine",
    # neuromuscular blockers / reversal
    "rocuronium", "vecuronium", "atracurium", "cisatracurium", "suxamethonium",
    "succinylcholine", "sugammadex", "neostigmine",
    # opioids
    "fentanyl", "remifentanil", "morphine", "oxycodone", "pethidine",
    # vasoactive
    "phenylephrine", "ephedrine", "metaraminol", "noradrenaline", "adrenaline",
    "atropine", "glycopyrrolate",
    # volatiles / gases
    "sevoflurane", "desflurane", "isoflurane", "nitrous",
    # local anesthetics / antiemetics / other
    "lignocaine", "lidocaine", "bupivacaine", "ropivacaine", "levobupivacaine",
    "ondansetron", "dexamethasone", "paracetamol", "tranexamic",
    # airway / technique
    "laryngoscopy", "Cormack", "Lehane", "bougie", "cricoid", "extubation",
    "LMA", "RSI", "intubation", "videolaryngoscopy",
]
