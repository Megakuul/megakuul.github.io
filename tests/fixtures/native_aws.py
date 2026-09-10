"""AWS request-shape fixture; never connects to AWS."""
import base64,json,os,sys,yaml
from pathlib import Path
from awscli.shorthand import ShorthandParser
shorthand=ShorthandParser()
class CFNLoader(yaml.SafeLoader):pass
def intrinsic(loader,name,node):
 value=loader.construct_sequence(node) if isinstance(node,yaml.SequenceNode) else loader.construct_mapping(node) if isinstance(node,yaml.MappingNode) else loader.construct_scalar(node)
 if name=='GetAtt' and isinstance(value,str):value=value.split('.',1)
 return {name if name=='Ref' else 'Fn::'+name:value}
CFNLoader.add_multi_constructor('!',intrinsic)
import botocore.session
from botocore import xform_name
from botocore.validate import validate_parameters
import jmespath
root=Path(os.environ['MOCK_ROOT']);args=sys.argv[1:];service,op=args[:2]
if service=='configure':print('eu-central-1');sys.exit()
if op=='wait':sys.exit()
model=botocore.session.get_session().get_service_model({'s3api':'s3','configservice':'config'}.get(service,service))
operation=next(n for n in model.operation_names if xform_name(n,'-')==op);shape=model.operation_model(operation).input_shape
payload={};query=None;output='json';i=2
if '--cli-input-json' in args:
 raw=args[args.index('--cli-input-json')+1];payload=json.loads(Path(raw.removeprefix('file://')).read_text() if raw.startswith('file://') else raw)
while i<len(args):
 flag=args[i]
 if flag=='--cli-input-json':i+=2;continue
 if flag in ['--query','--output','--region','--cli-binary-format']:
  if flag=='--query':query=args[i+1]
  if flag=='--output':output=args[i+1]
  i+=2;continue
 if flag=='--no-cli-pager':i+=1;continue
 if flag=='--zip-file':payload['Code']={'ZipFile':Path(args[i+1].removeprefix('fileb://')).read_bytes()};i+=2;continue
 key=next(k for k in shape.members if '--'+xform_name(k,'-')==flag)
 typ=shape.members[key].type_name
 if typ=='boolean':payload[key]=True;i+=1;continue
 value=args[i+1]
 if typ in ['list','map','structure']:
  if value.startswith(('[','{')):value=json.loads(value)
  elif typ=='list':
   values=[];i+=1
   while i<len(args) and not args[i].startswith('--'):values.append(args[i]);i+=1
   payload[key]=[shorthand.parse(v) if shape.members[key].member.type_name in ['map','structure'] else v for v in values];continue
  else:value=shorthand.parse(value)
 elif typ in ['integer','long']:value=int(value)
 payload[key]=value;i+=2
def coerce(value,shape):
 if shape.type_name=='structure':return {k:coerce(v,shape.members[k]) for k,v in value.items()}
 if shape.type_name=='list':return [coerce(v,shape.member) for v in value]
 if shape.type_name=='map':return {k:coerce(v,shape.value) for k,v in value.items()}
 if shape.type_name=='boolean' and isinstance(value,str):return value.lower()=='true'
 if shape.type_name in ['integer','long'] and isinstance(value,str):return int(value)
 return value
if shape:payload=coerce(payload,shape);validate_parameters(payload,shape)
record={'service':service,'operation':op,'payload':payload}
if service=='cloudformation' and 'TemplateBody' in payload:
 record['templateText']=Path(payload['TemplateBody'].removeprefix('file://')).read_text() if payload['TemplateBody'].startswith('file://') else payload['TemplateBody']
 record['template']=yaml.load(record['templateText'],Loader=CFNLoader)
with (root/'calls.jsonl').open('a') as f:f.write(json.dumps(record,default=lambda b:{'zip':base64.b64encode(b).decode()})+'\n')
if os.environ.get('MOCK_FAIL')==service+':'+op:print('An error occurred (AccessDeniedException) when calling operation: denied',file=sys.stderr);sys.exit(42)
if os.environ.get('MOCK_EXISTING') and service=='logs' and op=='create-log-group':print('An error occurred (ResourceAlreadyExistsException) when calling CreateLogGroup: exists',file=sys.stderr);sys.exit(1)
region=os.environ.get('AWS_REGION','eu-central-1');account='111122223333';base=f'arn:aws:{service}:{region}:{account}:';result={}
if service=='sts':result={'Account':account,'Arn':f'arn:aws:iam::{account}:user/operator'}
elif service=='cloudformation':result={'StackId':base+'stack/test/id'}
elif service=='iam' and op=='get-role':result={'Role':{'RoleName':payload['RoleName'],'Arn':f'arn:aws:iam::{account}:role/'+payload['RoleName']}}
elif service=='logs' and op=='put-delivery-destination':result={'deliveryDestination':{'arn':base+'delivery-destination:'+payload['name']}}
elif service=='sqs' and op=='create-queue':result={'QueueUrl':f'https://sqs.{region}.amazonaws.com/{account}/'+payload['QueueName']}
elif service=='wafv2' and op=='create-web-acl':result={'Summary':{'ARN':base+'regional/webacl/'+payload['Name']+'/id','Id':'id'}}
elif service=='lambda' and op=='create-function':result={'FunctionArn':base+'function:'+payload['FunctionName']}
elif service=='secretsmanager' and op=='create-secret':result={'ARN':base+'secret:'+payload['Name']+'-abcdef'}
elif service=='appconfig' and op.startswith('create-'):result={'Id':'abcd123'}
elif service=='events' and op=='put-targets':result={'FailedEntryCount':1 if os.environ.get('MOCK_TARGET_FAILURE') else 0}
elif service=='guardduty' and op=='list-detectors':result={'DetectorIds':['a'*32] if os.environ.get('MOCK_EXISTING') else []}
elif service=='guardduty' and op=='create-detector':result={'DetectorId':'a'*32}
elif service=='accessanalyzer' and op=='list-analyzers':result={'analyzers':[{'name':'existing','type':'ACCOUNT','status':'ACTIVE','arn':f'arn:aws:access-analyzer:{region}:{account}:analyzer/existing'}] if os.environ.get('MOCK_EXISTING') else []}
elif service=='accessanalyzer' and op=='create-analyzer':result={'arn':f'arn:aws:access-analyzer:{region}:{account}:analyzer/'+payload['analyzerName']}
elif service=='ec2' and op=='create-security-group':result={'GroupId':'sg-0123456789abcdef0'}
elif service=='eks' and op=='update-cluster-config':result={'update':{'id':'update-id'}}
if query:result=jmespath.search(query,result)
print(('None' if result is None else str(result)) if output=='text' else json.dumps(result))
