import sys
import os

INTERP = os.path.expanduser("/var/www/u3383175/data/flaskenv/bin/python")
if sys.executable != INTERP:
   os.execl(INTERP, INTERP, *sys.argv)

sys.path.insert(0, os.getcwd())

from app import application
