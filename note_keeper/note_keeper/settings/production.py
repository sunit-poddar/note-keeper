from .base import *

DEBUG = False
ALLOWED_HOSTS = ['sunitpoddar.dev']
FORCE_SCRIPT_NAME = '/notekeeper'
USE_X_FORWARDED_HOST = True
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')
