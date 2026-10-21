"""Conversions used for every China price on the site. Keep them identical across updates.

    python3 scripts/convert.py tonne 102950     -> US$ per tonne from yuan per tonne
    python3 scripts/convert.py kwh 0.360        -> US$/kWh excl. VAT from yuan/Wh incl. 13% VAT
"""
import sys
FX, VAT = 6.70, 1.13
def tonne(cny): return round(cny / FX / 10) * 10
def kwh(cny_per_wh): return round(cny_per_wh / VAT * 1000 / FX, 1)
if __name__ == "__main__":
    kind, val = sys.argv[1], float(sys.argv[2])
    print({"tonne": tonne, "kwh": kwh}[kind](val))
