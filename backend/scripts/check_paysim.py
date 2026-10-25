"""Streaming schema, hash, range and recurrence inspection; no training."""
import argparse,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from traceguard.paysim_adapter import status
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('csv_path',nargs='?',type=Path);a=p.parse_args()
    result=status(a.csv_path);print(json.dumps(result,indent=2))
    raise SystemExit(0 if result['status']=='available' else 1)
