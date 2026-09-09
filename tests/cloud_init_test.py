"""Cloud-init examples: schema, shell syntax, boot failure handling and launch inputs."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import yaml

ROOT=Path(__file__).resolve().parents[1]
CONFIGS={p.stem:yaml.safe_load(p.read_text()) for p in (ROOT/'static/downloads/cloud-init').glob('*.yaml')}
SNIPPETS=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import * as s from './src/routes/worldskills/cloud-init/snippets.mjs'; console.log(JSON.stringify(s));"],cwd=ROOT,text=True))

def contents(config,path):return next(f['content'] for f in config['write_files'] if f['path']==path)

class CloudInitTests(unittest.TestCase):
    def test_yaml_shell_and_downloads_are_consistent(self):
        self.assertEqual(len(CONFIGS),8)
        for snippet in SNIPPETS['cloudConfigs']:
            path=ROOT/'static'/snippet['download'].lstrip('/')
            self.assertTrue(path.read_text().startswith('#cloud-config\n'))
            self.assertLess(path.stat().st_size,16384)
            config=CONFIGS[snippet['id']]
            self.assertFalse(config['ssh_pwauth']);self.assertTrue(config['disable_root'])
            for f in config['write_files']:
                self.assertTrue(f['defer'])
                if f['content'].startswith('#!/bin/bash'):
                    check=subprocess.run(['bash','-n'],input=f['content'],text=True,capture_output=True)
                    self.assertEqual(check.returncode,0,check.stderr)
            for cmd in config['runcmd']:self.assertIsInstance(cmd,list)
        for s in SNIPPETS['commands']+SNIPPETS['operations']:
            result=subprocess.run(['bash','-n','-c',s['code']],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
    @unittest.skipUnless(os.environ.get('CLOUD_INIT_SCHEMA'),'Set CLOUD_INIT_SCHEMA to the upstream cloud-init 22.2 schema')
    def test_upstream_cloud_init_schema(self):
        import jsonschema
        schema=json.loads(Path(os.environ['CLOUD_INIT_SCHEMA']).read_text())
        for name,config in CONFIGS.items():
            with self.subTest(name=name):jsonschema.validate(config,schema)
    def test_s3_bootstrap_downloads_exact_version_before_start_and_stops_on_failure(self):
        for name in ['node-s3','python-s3','java-s3','binary-s3']:
            for failure in [False,True]:
                with self.subTest(name=name,failure=failure),tempfile.TemporaryDirectory() as work:
                    work=Path(work);app=work/'app';envfile=work/'bootstrap.env';calls=work/'calls'
                    envfile.write_text(contents(CONFIGS[name],'/etc/bootstrap.env').replace('OBJECT_VERSION=','OBJECT_VERSION=version-123'))
                    script=contents(CONFIGS[name],'/usr/local/sbin/bootstrap-app').replace('/etc/bootstrap.env',str(envfile)).replace('/opt/app',str(app))
                    aws=work/'aws';aws.write_text('#!'+sys.executable+'\nimport sys,os,json\nfrom pathlib import Path\nwith open(os.environ["CALLS"],"a") as f:f.write(json.dumps(sys.argv[1:])+"\\n")\nif os.environ["FAIL"]=="1":sys.exit(42)\nPath(sys.argv[-1]).write_text("artifact data")\n');aws.chmod(0o755)
                    install=work/'install';install.write_text('#!'+sys.executable+'\nimport sys,subprocess\na=sys.argv[1:]\nfor k in ["-o","-g"]:\n if k in a:\n  i=a.index(k);del a[i:i+2]\nsys.exit(subprocess.call([os.environ["REAL_INSTALL"]]+a))\n'.replace('import sys,subprocess','import sys,subprocess,os'));install.chmod(0o755)
                    systemctl=work/'systemctl';systemctl.write_text('#!'+shutil.which('bash')+'\nprintf "systemctl %s\\n" "$*" >> "$CALLS"\n');systemctl.chmod(0o755)
                    env={**os.environ,'PATH':str(work)+':'+os.environ['PATH'],'CALLS':str(calls),'FAIL':str(int(failure)),'REAL_INSTALL':shutil.which('install')}
                    result=subprocess.run(['bash','-c',script],env=env,capture_output=True,text=True)
                    self.assertEqual(result.returncode,42 if failure else 0,result.stderr)
                    lines=calls.read_text().splitlines();request=json.loads(lines[0]);self.assertEqual(request[:2],['s3api','get-object'])
                    self.assertEqual(request[request.index('--version-id')+1],'version-123')
                    self.assertEqual(any('systemctl enable --now app.service' in line for line in lines),not failure)
                    self.assertEqual(list(app.glob('.download.*')),[])
                    if not failure:
                        artifact=next(app.iterdir());self.assertEqual(artifact.read_text(),'artifact data');self.assertEqual(artifact.stat().st_mode & 0o777,0o755 if name=='binary-s3' else 0o644)
    def test_runtime_is_unprivileged_and_ecs_avoids_cloud_final_deadlock(self):
        for name in ['node-s3','python-s3','java-s3','binary-s3']:
            service=contents(CONFIGS[name],'/etc/systemd/system/app.service')
            self.assertIn('User=app\n',service);self.assertIn('ProtectSystem=strict\n',service);self.assertIn('Restart=on-failure\n',service)
            self.assertNotIn('After=cloud-final.service',service)
        self.assertIn('--no-block',CONFIGS['ecs-host']['runcmd'][0])
        docker=contents(CONFIGS['ecr-container'],'/etc/systemd/system/app.service')
        for flag in ['--read-only','--user 10001:10001','--cap-drop=ALL','--security-opt=no-new-privileges','--log-opt max-size=10m']:
            self.assertIn(flag,docker)
        self.assertNotIn('/var/run/docker.sock:',docker)
    def test_launch_uses_downloaded_userdata_and_safe_metadata_tags_and_storage(self):
        launch=next(s['code'] for s in SNIPPETS['commands'] if s['id']=='launch')
        with tempfile.TemporaryDirectory() as work:
            work=Path(work);calls=work/'calls';aws=work/'aws'
            aws.write_text('#!'+sys.executable+'\nimport sys,os,json\nwith open(os.environ["CALLS"],"a") as f:f.write(json.dumps(sys.argv[1:])+"\\n")\nprint("ami-0123456789abcdef0" if sys.argv[1]=="ssm" else "i-0123456789abcdef0")\n');aws.chmod(0o755)
            env={**os.environ,'PATH':str(work)+':'+os.environ['PATH'],'CALLS':str(calls),'REGION':'eu-central-1','NAME':'my-app','TAG_KEY':'Team / Project','TAG_VALUE':'test = app','AMI_PARAMETER':'/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64','INSTANCE_PROFILE':'my-role','INSTANCE_TYPE':'t3.small','SUBNET_ID':'subnet-123','SECURITY_GROUP_ID':'sg-123','USER_DATA_FILE':'./node-s3.yaml'}
            run=subprocess.run(['bash','-c',launch],env=env,capture_output=True,text=True);self.assertEqual(run.returncode,0,run.stderr)
            command=json.loads(calls.read_text().splitlines()[1]);arg=lambda name:command[command.index(name)+1]
            self.assertEqual(arg('--user-data'),'file://./node-s3.yaml')
            self.assertIn('HttpTokens=required',arg('--metadata-options'));self.assertIn('--no-associate-public-ip-address',command)
            tags=json.loads(arg('--tag-specifications'));self.assertEqual({t['ResourceType'] for t in tags},{'instance','volume','network-interface'})
            for t in tags:self.assertIn({'Key':'Team / Project','Value':'test = app'},t['Tags'])
            self.assertTrue(json.loads(arg('--block-device-mappings'))[0]['Ebs']['Encrypted'])
    def test_policies_scope_artifacts_and_repository(self):
        for s in SNIPPETS['policies']:
            for statement in json.loads(s['code'])['Statement']:
                if statement['Resource']=='*':self.assertEqual(statement['Action'],'ecr:GetAuthorizationToken')
                self.assertEqual(statement['Effect'],'Allow')
        policy=json.loads(next(s['code'] for s in SNIPPETS['policies'] if s['id']=='s3-site-policy'))
        self.assertIn('s3:prefix',policy['Statement'][0]['Condition']['StringLike'])

if __name__=='__main__':unittest.main()
