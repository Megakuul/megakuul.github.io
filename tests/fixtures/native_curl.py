"""Serve the canonical YAML to copied curl commands without network access."""
import os,sys
from pathlib import Path
name=os.environ['MOCK_TEMPLATE_FILE']
assert sys.argv[1:]==['-fsSL','https://megakuul.ch/worldskills/powertools/templates/'+name,'-o',name]
if os.environ.get('MOCK_CURL_FAIL'):sys.exit(22)
Path(name).write_bytes((Path(os.environ['MOCK_ROOT'])/'download.yaml').read_bytes())
