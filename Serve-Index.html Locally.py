import subprocess
import sys
import os
from flask import Flask, send_from_directory, abort

# Function to install a package
def install_package(package):
    subprocess.check_call([sys.executable, "-m", "pip", "install", package])

# List of required packages
required_packages = [
    "flask",  # Add all the packages your script needs here
    # "numpy",
    # "pandas",
    # ...
]

# Attempt to import each package, install if not found
for package in required_packages:
    try:
        __import__(package)
    except ImportError:
        print(f"Package {package} not found. Installing...")
        install_package(package)

# Your existing app.py code starts here

app = Flask(__name__)

@app.route('/')
def index():
    if os.path.exists('index.html'):
        return send_from_directory('.', 'index.html')
    else:
        abort(404)

@app.route('/<path:path>')
def static_files(path):
    if os.path.exists(path):
        return send_from_directory('.', path)
    else:
        abort(404)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
