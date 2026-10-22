"""A starter catalog of medicines commonly sold in Pakistan.

So a new pharmacy opens with shelves rather than an empty screen. Every line is
a starting point the administrator is expected to correct:

* **Prices are estimates** of retail prices at the time of writing, not DRAP's
  maximum retail prices. They load with ``priceReviewed`` false, and the
  catalog screen marks each one until somebody has checked it against the pack.
* **Stock is a placeholder.** Each product loads with ``STARTER_STOCK`` so the
  ordering flow can be exercised end to end; the real count is whatever is on
  the shelf.
* **Manufacturers are named only where the brand is unambiguous.** A wrong
  manufacturer on a medicine is worse than a blank one.

What is deliberately absent: anything scheduled as a controlled substance
(narcotics, psychotropics, codeine syrups) — those cannot lawfully be sold this
way — and anything that needs a cold chain, such as insulin, which a courier
bag cannot carry safely.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

#: Units each starter product arrives with. See the module docstring.
STARTER_STOCK = 100

PAIN = "Pain & Fever"
COLD = "Cold, Cough & Allergy"
STOMACH = "Stomach & Digestion"
INFECTION = "Antibiotics & Infections"
DIABETES = "Diabetes"
HEART = "Heart & Blood Pressure"
VITAMINS = "Vitamins & Supplements"
SKIN = "Skin Care"
EYE_EAR = "Eye & Ear"
FIRST_AID = "First Aid"
HORMONES = "Thyroid & Steroids"

#: The order categories appear in, which is roughly how often people look for
#: them — not alphabetical.
CATEGORIES: tuple[str, ...] = (
    PAIN,
    COLD,
    STOMACH,
    INFECTION,
    VITAMINS,
    DIABETES,
    HEART,
    SKIN,
    EYE_EAR,
    FIRST_AID,
    HORMONES,
)

#: name, generic name, strength, form, pack, category, manufacturer, price (PKR),
#: prescription required, short description.
_ROWS: tuple[tuple[Any, ...], ...] = (
    # Pain & fever
    ("Panadol", "Paracetamol", "500 mg", "TABLET", "Strip of 10 tablets", PAIN, "Haleon", "40", False,
     "For fever and mild to moderate pain."),
    ("Panadol Extra", "Paracetamol + Caffeine", "500 mg / 65 mg", "TABLET", "Strip of 10 tablets", PAIN,
     "Haleon", "65", False, "For headache and pain that needs a little more."),
    ("Calpol", "Paracetamol", "120 mg/5 ml", "SYRUP", "90 ml bottle", PAIN, "Haleon", "150", False,
     "Fever and pain relief for children."),
    ("Brufen", "Ibuprofen", "400 mg", "TABLET", "Strip of 10 tablets", PAIN, "Abbott", "75", False,
     "For pain, inflammation and fever."),
    ("Brufen", "Ibuprofen", "100 mg/5 ml", "SUSPENSION", "90 ml bottle", PAIN, "Abbott", "160", False,
     "Fever and pain relief for children."),
    ("Ponstan Forte", "Mefenamic acid", "500 mg", "TABLET", "Strip of 10 tablets", PAIN, "Pfizer", "110",
     False, "For period pain and other mild to moderate pain."),
    ("Disprin", "Aspirin", "300 mg", "TABLET", "Strip of 10 dispersible tablets", PAIN, "Reckitt", "30",
     False, "For pain and fever in adults. Not for children under 16."),
    ("Synflex", "Naproxen sodium", "550 mg", "TABLET", "Strip of 10 tablets", PAIN, None, "160", False,
     "For joint, muscle and period pain."),
    ("Voltral", "Diclofenac sodium", "50 mg", "TABLET", "Strip of 10 tablets", PAIN, "Novartis", "95", True,
     "For pain and inflammation."),
    ("Voltral Emulgel", "Diclofenac diethylamine", "1%", "GEL", "20 g tube", PAIN, None, "390", False,
     "Rubbed on for muscle and joint pain."),
    # Cold, cough & allergy
    ("Rigix", "Cetirizine", "10 mg", "TABLET", "Strip of 10 tablets", COLD, None, "130", False,
     "For hay fever, itching and allergic rhinitis."),
    ("Softin", "Loratadine", "10 mg", "TABLET", "Strip of 10 tablets", COLD, None, "150", False,
     "Non-drowsy allergy relief."),
    ("Telfast", "Fexofenadine", "120 mg", "TABLET", "Strip of 10 tablets", COLD, "Sanofi", "480", False,
     "Non-drowsy relief for seasonal allergies."),
    ("Telfast", "Fexofenadine", "180 mg", "TABLET", "Strip of 10 tablets", COLD, "Sanofi", "620", False,
     "Non-drowsy relief for hives and allergies."),
    ("Avil", "Pheniramine maleate", "25 mg", "TABLET", "Strip of 10 tablets", COLD, "Sanofi", "45", False,
     "For allergic reactions and itching. May cause drowsiness."),
    ("Hydryllin", "Diphenhydramine + Ammonium chloride", None, "SYRUP", "120 ml bottle", COLD, "Searle",
     "170", False, "For cough with congestion. May cause drowsiness."),
    ("Acefyl", "Acefylline piperazine + Diphenhydramine", None, "SYRUP", "125 ml bottle", COLD, None, "195",
     False, "For cough and chest congestion."),
    ("Otrivin", "Xylometazoline", "0.1%", "SPRAY", "10 ml nasal spray", COLD, "Haleon", "240", False,
     "For a blocked nose. Not for more than seven days in a row."),
    ("Strepsils Honey & Lemon", "Amylmetacresol + Dichlorobenzyl alcohol", None, "OTHER",
     "Pack of 24 lozenges", COLD, "Reckitt", "440", False, "Soothes a sore throat."),
    ("Ventolin Inhaler", "Salbutamol", "100 mcg/dose", "INHALER", "200 doses", COLD, "GSK", "620", True,
     "Reliever inhaler for asthma and wheezing."),
    ("Montiget", "Montelukast", "10 mg", "TABLET", "Pack of 14 tablets", COLD, "Getz Pharma", "560", True,
     "For asthma prevention and allergic rhinitis."),
    # Stomach & digestion
    ("Risek", "Omeprazole", "20 mg", "CAPSULE", "Pack of 14 capsules", STOMACH, "Getz Pharma", "390", False,
     "For heartburn and acid reflux."),
    ("Risek", "Omeprazole", "40 mg", "CAPSULE", "Pack of 14 capsules", STOMACH, "Getz Pharma", "560", True,
     "For ulcers and severe reflux."),
    ("Nexum", "Esomeprazole", "40 mg", "TABLET", "Pack of 14 tablets", STOMACH, "Getz Pharma", "590", True,
     "For ulcers and severe reflux."),
    ("Motilium", "Domperidone", "10 mg", "TABLET", "Strip of 10 tablets", STOMACH, "Janssen", "120", False,
     "For nausea and bloating."),
    ("Gravinate", "Dimenhydrinate", "50 mg", "TABLET", "Strip of 10 tablets", STOMACH, "Searle", "75", False,
     "For nausea, vomiting and travel sickness."),
    ("Gaviscon", "Sodium alginate + Sodium bicarbonate + Calcium carbonate", None, "SUSPENSION",
     "120 ml bottle", STOMACH, "Reckitt", "350", False, "For heartburn and indigestion."),
    ("Mucaine", "Oxetacaine + Aluminium hydroxide + Magnesium hydroxide", None, "SUSPENSION",
     "120 ml bottle", STOMACH, "Pfizer", "230", False, "For acidity and stomach pain."),
    ("Peditral", "Oral rehydration salts", None, "SACHET", "Pack of 10 sachets", STOMACH, "Searle", "210",
     False, "Replaces the fluids and salts lost to diarrhoea."),
    ("Imodium", "Loperamide", "2 mg", "CAPSULE", "Strip of 6 capsules", STOMACH, "Janssen", "150", False,
     "For short-term diarrhoea in adults."),
    ("Buscopan", "Hyoscine butylbromide", "10 mg", "TABLET", "Strip of 10 tablets", STOMACH, None, "170",
     False, "For stomach cramps."),
    ("Duphalac", "Lactulose", "3.35 g/5 ml", "SYRUP", "120 ml bottle", STOMACH, "Abbott", "540", False,
     "For constipation."),
    ("Vermox", "Mebendazole", "100 mg", "TABLET", "Strip of 6 chewable tablets", STOMACH, "Janssen", "120",
     False, "For threadworm and other worm infections."),
    # Antibiotics & infections
    ("Augmentin", "Amoxicillin + Clavulanic acid", "625 mg", "TABLET", "Pack of 6 tablets", INFECTION,
     "GSK", "640", True, "Antibiotic."),
    ("Augmentin", "Amoxicillin + Clavulanic acid", "156.25 mg/5 ml", "SUSPENSION", "90 ml bottle",
     INFECTION, "GSK", "350", True, "Antibiotic for children."),
    ("Amoxil", "Amoxicillin", "500 mg", "CAPSULE", "Pack of 20 capsules", INFECTION, "GSK", "340", True,
     "Antibiotic."),
    ("Velosef", "Cephradine", "500 mg", "CAPSULE", "Pack of 12 capsules", INFECTION, "GSK", "450", True,
     "Antibiotic."),
    ("Azomax", "Azithromycin", "500 mg", "TABLET", "Pack of 6 tablets", INFECTION, None, "620", True,
     "Antibiotic."),
    ("Ciproxin", "Ciprofloxacin", "500 mg", "TABLET", "Pack of 10 tablets", INFECTION, "Bayer", "690", True,
     "Antibiotic."),
    ("Klaricid", "Clarithromycin", "500 mg", "TABLET", "Pack of 10 tablets", INFECTION, "Abbott", "1150",
     True, "Antibiotic."),
    ("Cefspan", "Cefixime", "400 mg", "CAPSULE", "Pack of 5 capsules", INFECTION, "Barrett Hodgson", "640",
     True, "Antibiotic."),
    ("Leflox", "Levofloxacin", "500 mg", "TABLET", "Pack of 10 tablets", INFECTION, "Getz Pharma", "580",
     True, "Antibiotic."),
    ("Septran DS", "Sulfamethoxazole + Trimethoprim", "800 mg / 160 mg", "TABLET", "Strip of 10 tablets",
     INFECTION, "GSK", "130", True, "Antibiotic."),
    ("Flagyl", "Metronidazole", "400 mg", "TABLET", "Strip of 10 tablets", INFECTION, "Sanofi", "70", True,
     "For gut and other infections."),
    ("Diflucan", "Fluconazole", "150 mg", "CAPSULE", "1 capsule", INFECTION, "Pfizer", "400", True,
     "Antifungal."),
    ("Coartem", "Artemether + Lumefantrine", "20 mg / 120 mg", "TABLET", "Pack of 24 tablets", INFECTION,
     "Novartis", "950", True, "For malaria."),
    # Vitamins & supplements
    ("Surbex Z", "Multivitamin + Zinc", None, "TABLET", "Pack of 30 tablets", VITAMINS, "Abbott", "690",
     False, "Daily multivitamin with zinc."),
    ("Centrum Adults", "Multivitamin and multimineral", None, "TABLET", "Pack of 30 tablets", VITAMINS,
     "Haleon", "1900", False, "Daily multivitamin."),
    ("CaC-1000 Plus", "Calcium + Vitamin C", "1000 mg", "TABLET", "Tube of 10 effervescent tablets",
     VITAMINS, "Haleon", "400", False, "Dissolve in water."),
    ("Qalsan-D", "Calcium carbonate + Vitamin D3", None, "TABLET", "Pack of 30 tablets", VITAMINS, None,
     "450", False, "For bone health."),
    ("Sunny D", "Cholecalciferol (Vitamin D3)", "200,000 IU", "CAPSULE", "Pack of 2 capsules", VITAMINS,
     None, "450", False, "High-strength vitamin D. Take as your doctor advises."),
    ("Fefol", "Ferrous sulphate + Folic acid", None, "CAPSULE", "Pack of 30 capsules", VITAMINS, None, "240",
     False, "Iron and folic acid."),
    ("Folic Acid", "Folic acid", "5 mg", "TABLET", "Pack of 30 tablets", VITAMINS, None, "70", False,
     "Folic acid supplement."),
    ("Neurobion", "Vitamin B1 + B6 + B12", None, "TABLET", "Pack of 30 tablets", VITAMINS, None, "450",
     False, "Vitamin B complex for nerve health."),
    ("Evion", "Vitamin E (Tocopheryl acetate)", "400 mg", "CAPSULE", "Strip of 10 capsules", VITAMINS,
     None, "260", False, "Vitamin E supplement."),
    ("Zincat", "Zinc sulphate", "20 mg/5 ml", "SYRUP", "60 ml bottle", VITAMINS, None, "130", False,
     "Zinc for children with diarrhoea."),
    # Diabetes
    ("Glucophage", "Metformin", "500 mg", "TABLET", "Pack of 50 tablets", DIABETES, "Merck", "230", True,
     "For type 2 diabetes."),
    ("Glucophage", "Metformin", "850 mg", "TABLET", "Pack of 50 tablets", DIABETES, "Merck", "320", True,
     "For type 2 diabetes."),
    ("Amaryl", "Glimepiride", "2 mg", "TABLET", "Pack of 20 tablets", DIABETES, "Sanofi", "440", True,
     "For type 2 diabetes."),
    ("Diamicron MR", "Gliclazide", "30 mg", "TABLET", "Pack of 30 tablets", DIABETES, "Servier", "620", True,
     "For type 2 diabetes."),
    ("Galvus Met", "Vildagliptin + Metformin", "50 mg / 500 mg", "TABLET", "Pack of 14 tablets", DIABETES,
     "Novartis", "1000", True, "For type 2 diabetes."),
    # Heart & blood pressure
    ("Norvasc", "Amlodipine", "5 mg", "TABLET", "Pack of 20 tablets", HEART, "Pfizer", "680", True,
     "For high blood pressure."),
    ("Concor", "Bisoprolol", "5 mg", "TABLET", "Pack of 30 tablets", HEART, "Merck", "590", True,
     "For high blood pressure and heart conditions."),
    ("Cozaar", "Losartan", "50 mg", "TABLET", "Pack of 20 tablets", HEART, "Organon", "740", True,
     "For high blood pressure."),
    ("Tenormin", "Atenolol", "50 mg", "TABLET", "Pack of 14 tablets", HEART, None, "280", True,
     "For high blood pressure."),
    ("Lasix", "Furosemide", "40 mg", "TABLET", "Strip of 10 tablets", HEART, "Sanofi", "95", True,
     "Water tablet."),
    ("Lipiget", "Atorvastatin", "10 mg", "TABLET", "Pack of 10 tablets", HEART, "Getz Pharma", "290", True,
     "For cholesterol."),
    ("Rovista", "Rosuvastatin", "10 mg", "TABLET", "Pack of 10 tablets", HEART, "Getz Pharma", "410", True,
     "For cholesterol."),
    ("Loprin", "Aspirin", "75 mg", "TABLET", "Pack of 30 tablets", HEART, "Highnoon", "95", True,
     "Low-dose aspirin for heart protection."),
    ("Plavix", "Clopidogrel", "75 mg", "TABLET", "Pack of 14 tablets", HEART, "Sanofi", "1150", True,
     "Blood thinner."),
    # Skin care
    ("Polyfax", "Polymyxin B + Bacitracin zinc", None, "OINTMENT", "20 g tube", SKIN, "GSK", "400", False,
     "Antibiotic ointment for minor cuts and burns."),
    ("Canesten", "Clotrimazole", "1%", "CREAM", "20 g tube", SKIN, "Bayer", "440", False,
     "For fungal skin infections."),
    ("Daktarin", "Miconazole nitrate", "2%", "CREAM", "15 g tube", SKIN, "Janssen", "390", False,
     "For fungal skin infections."),
    ("Benzac AC", "Benzoyl peroxide", "5%", "GEL", "60 g tube", SKIN, "Galderma", "1300", False,
     "For acne."),
    ("Fucidin", "Fusidic acid", "2%", "CREAM", "15 g tube", SKIN, "LEO Pharma", "560", True,
     "Antibiotic cream for skin infections."),
    ("Betnovate-N", "Betamethasone + Neomycin", "0.1% / 0.5%", "CREAM", "15 g tube", SKIN, "GSK", "270",
     True, "Steroid and antibiotic cream."),
    # Eye & ear
    ("Refresh Tears", "Carboxymethylcellulose sodium", "0.5%", "DROPS", "15 ml bottle", EYE_EAR,
     "Allergan", "580", False, "For dry, tired eyes."),
    ("Vigamox", "Moxifloxacin", "0.5%", "DROPS", "5 ml bottle", EYE_EAR, None, "680", True,
     "Antibiotic eye drops."),
    ("Otosporin", "Polymyxin B + Neomycin + Hydrocortisone", None, "DROPS", "5 ml bottle", EYE_EAR, None,
     "290", True, "For outer ear infections."),
    # First aid
    ("Dettol Antiseptic Liquid", "Chloroxylenol", "4.8%", "SOLUTION", "120 ml bottle", FIRST_AID, "Reckitt",
     "280", False, "Dilute before use on cuts and grazes."),
    ("Pyodine", "Povidone-iodine", "10%", "SOLUTION", "60 ml bottle", FIRST_AID, None, "230", False,
     "Antiseptic for wounds."),
    # Thyroid & steroids
    ("Euthyrox", "Levothyroxine sodium", "50 mcg", "TABLET", "Pack of 100 tablets", HORMONES, "Merck", "470",
     True, "Thyroid hormone replacement."),
    ("Deltacortril", "Prednisolone", "5 mg", "TABLET", "Pack of 30 tablets", HORMONES, "Pfizer", "160",
     True, "Steroid."),
)


def starter_products() -> list[dict[str, Any]]:
    """The catalog as product fields, ready to load."""
    return [
        {
            "name": name,
            "generic_name": generic,
            "strength": strength,
            "form": form,
            "pack_size": pack,
            "category": category,
            "manufacturer": manufacturer,
            "price": Decimal(price),
            "rx_required": rx,
            "description": description,
        }
        for (name, generic, strength, form, pack, category, manufacturer, price, rx, description) in _ROWS
    ]
