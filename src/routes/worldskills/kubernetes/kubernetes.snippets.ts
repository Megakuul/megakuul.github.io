/** Raw Kubernetes/EKS snippet catalogue. Highlighted at build time in +page.server.ts.
 *
 * Rules for the blobs: no backticks and no backslashes so they survive being stored
 * inside template literals verbatim.
 */

export interface Snippet {
  id: string;
  title: string;
  /** Short plain-text hint rendered above the code. */
  note?: string;
  code: string;
  /** shiki lang, defaults to 'yaml'. */
  lang?: string;
}

export interface Group {
  id: string;
  title: string;
  blurb: string;
  snippets: Snippet[];
}

const access: Group = {
  id: 'access',
  title: 'Cluster access',
  blurb:
    'Get kubectl talking to the cluster, then grant another IAM principal control-plane access.',
  snippets: [
    {
      id: 'access-login',
      title: 'Log in to EKS',
      lang: 'bash',
      code: `aws eks update-kubeconfig --region eu-central-1 --name my-cluster --alias my-cluster
kubectl config current-context
kubectl get nodes`,
    },
    {
      id: 'access-hardening',
      title: 'EKS logging + endpoint',
      note: 'Replace the example CIDR with your admin public IP /32. Keep private access enabled for nodes and VPC clients; disable public access only after verifying a private admin path.',
      lang: 'bash',
      code: `aws eks update-cluster-config --name my-cluster --logging '{"clusterLogging":[{"types":["api","audit","authenticator","controllerManager","scheduler"],"enabled":true}]}' --resources-vpc-config '{"endpointPrivateAccess":true,"endpointPublicAccess":true,"publicAccessCidrs":["198.51.100.10/32"]}'`,
    },
    {
      id: 'access-entry',
      title: 'Grant a role control-plane access (access entries)',
      note: 'Access entries replace the old aws-auth ConfigMap. An AWS-managed access policy needs no RBAC on the k8s side; a plain kubernetes-groups mapping needs a ClusterRoleBinding to mean anything.',
      lang: 'bash',
      code: `aws eks create-access-entry \\
  --cluster-name my-cluster \\
  --principal-arn arn:aws:iam::111122223333:role/my-role \\
  --type STANDARD

aws eks associate-access-policy \\
  --cluster-name my-cluster \\
  --principal-arn arn:aws:iam::111122223333:role/my-role \\
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \\
  --access-scope type=cluster

aws eks list-access-entries --cluster-name my-cluster
aws eks describe-access-entry --cluster-name my-cluster --principal-arn arn:aws:iam::111122223333:role/my-role`,
    },
  ],
};

const helpers: Group = {
  id: 'helpers',
  title: 'kubectl troubleshooting toolbox',
  blurb: 'One-liners for figuring out why a pod or a node is not doing what it should.',
  snippets: [
    {
      id: 'helpers-toolbox',
      title: 'The commands you reach for first',
      lang: 'bash',
      code: `kubectl get nodes -o wide
kubectl top nodes
kubectl top pods -A
kubectl get pods -A -o wide
kubectl get events -A --sort-by=.lastTimestamp
kubectl describe pod my-pod                          # reason for Pending / CrashLoopBackOff / ImagePullBackOff
kubectl logs -f my-pod -c my-container --previous     # --previous survives a crash restart
kubectl exec -it my-pod -- sh
kubectl get nodeclaims                                # karpenter: nodes it launched or is launching
kubectl describe nodeclaim my-nodeclaim
kubectl get nodepools
kubectl get ec2nodeclasses
kubectl rollout status deployment/my-app
kubectl rollout history deployment/my-app
kubectl rollout undo deployment/my-app
kubectl get pvc,pv
kubectl get sc
kubectl get sa,rolebinding,clusterrolebinding -A | grep my-app
kubectl drain node-1 --ignore-daemonsets --delete-emptydir-data
kubectl cordon node-1
kubectl uncordon node-1
kubectl api-resources
kubectl explain deployment.spec.template`,
    },
  ],
};

const workloads: Group = {
  id: 'workloads',
  title: 'Workloads',
  blurb:
    'Templates to get an app onto the cluster: a bare Pod, a Deployment, a StatefulSet, and how to expose them.',
  snippets: [
    {
      id: 'wl-pod',
      title: 'Pod',
      code: `apiVersion: v1
kind: Pod
metadata:
  name: my-pod
  labels:
    app: my-app
spec:
  containers:
    - name: app
      image: 111122223333.dkr.ecr.eu-central-1.amazonaws.com/my-app:latest
      ports:
        - containerPort: 8080
      resources:
        requests: { cpu: 100m, memory: 128Mi }
        limits: { cpu: 500m, memory: 256Mi }
      env:
        - name: ENV
          value: prod
      readinessProbe:
        httpGet: { path: /health, port: 8080 }
        initialDelaySeconds: 5
      livenessProbe:
        httpGet: { path: /health, port: 8080 }
        periodSeconds: 10`,
    },
    {
      id: 'wl-deployment',
      title: 'Deployment + Service (ClusterIP)',
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  selector:
    matchLabels: { app: my-app }
  template:
    metadata:
      labels: { app: my-app }
    spec:
      containers:
        - name: app
          image: 111122223333.dkr.ecr.eu-central-1.amazonaws.com/my-app:latest
          ports:
            - containerPort: 8080
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits: { cpu: 500m, memory: 256Mi }
---
apiVersion: v1
kind: Service
metadata:
  name: my-app
spec:
  type: ClusterIP
  selector: { app: my-app }
  ports:
    - port: 80
      targetPort: 8080`,
    },
    {
      id: 'wl-statefulset',
      title: 'StatefulSet + headless Service',
      note: 'volumeClaimTemplates mints one PVC per replica (data-my-db-0, data-my-db-1, ...), see the storage section below for the StorageClass. This plain PostgreSQL example deliberately uses one replica; use a replication-aware operator before scaling it. The inline Secret is only a runnable placeholder—replace it with a managed secret before real use.',
      code: `apiVersion: v1
kind: Secret
metadata:
  name: my-db
type: Opaque
stringData:
  password: change-me-now
---
apiVersion: v1
kind: Service
metadata:
  name: my-db
spec:
  clusterIP: None
  selector: { app: my-db }
  ports:
    - port: 5432
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: my-db
spec:
  serviceName: my-db
  replicas: 1
  selector:
    matchLabels: { app: my-db }
  template:
    metadata:
      labels: { app: my-db }
    spec:
      containers:
        - name: db
          image: postgres:16
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef: { name: my-db, key: password }
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: [ReadWriteOnce]
        storageClassName: ebs-sc
        resources:
          requests: { storage: 20Gi }`,
    },
    {
      id: 'wl-lb-service',
      title: 'Service (internet-facing NLB)',
      note: 'Needs the AWS Load Balancer Controller. Replace the client CIDR; restrict ingress even for an internet-facing load balancer.',
      code: `apiVersion: v1
kind: Service
metadata:
  name: my-app
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-type: external
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: ip
    service.beta.kubernetes.io/aws-load-balancer-scheme: internet-facing
spec:
  type: LoadBalancer
  loadBalancerSourceRanges: [198.51.100.10/32]
  selector: { app: my-app }
  ports:
    - port: 80
      targetPort: 8080`,
    },
    {
      id: 'wl-ingress',
      title: 'Ingress (ALB)',
      note: 'Replace the client CIDR, ACM certificate, WAF ARN and log bucket. The bucket must allow ELB log delivery; use the policy below. Certificate, WAF and bucket must be in the ALB region.',
      code: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/inbound-cidrs: 198.51.100.10/32
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS":443}]'
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:eu-central-1:111122223333:certificate/12345678-1234-1234-1234-123456789abc
    alb.ingress.kubernetes.io/ssl-policy: ELBSecurityPolicy-TLS13-1-2-2021-06
    alb.ingress.kubernetes.io/wafv2-acl-arn: arn:aws:wafv2:eu-central-1:111122223333:regional/webacl/app/12345678-1234-1234-1234-123456789abc
    alb.ingress.kubernetes.io/load-balancer-attributes: access_logs.s3.enabled=true,access_logs.s3.bucket=my-alb-logs,access_logs.s3.prefix=alb,deletion_protection.enabled=true,routing.http.drop_invalid_header_fields.enabled=true
    alb.ingress.kubernetes.io/tags: Project=worldskills
spec:
  ingressClassName: alb
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app
                port: { number: 80 }`,
    },
    {
      id: 'wl-alb-log-policy',
      title: 'ALB log policy',
      note: 'Add this statement to the log bucket policy. Match the bucket, account and prefix; use SSE-S3 encryption and enable lifecycle separately.',
      lang: 'json',
      code: `{
  "Effect": "Allow",
  "Principal": { "Service": "logdelivery.elasticloadbalancing.amazonaws.com" },
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::my-alb-logs/alb/AWSLogs/111122223333/*"
}`,
    },
  ],
};

const identity: Group = {
  id: 'identity',
  title: 'IAM for pods',
  blurb:
    'Give a pod real AWS permissions without baking credentials into it, both ways EKS supports.',
  snippets: [
    {
      id: 'id-oidc-provider',
      title: 'Associate an OIDC provider with the cluster (IRSA prerequisite, once per cluster)',
      note: 'IRSA does not work until this exists. eksctl discovers the cluster issuer and current CA thumbprint, and --approve idempotently creates the provider when it is missing.',
      lang: 'bash',
      code: `eksctl utils associate-iam-oidc-provider \\
  --cluster my-cluster \\
  --region eu-central-1 \\
  --approve

aws eks describe-cluster --name my-cluster --region eu-central-1 --query "cluster.identity.oidc.issuer" --output text
aws iam list-open-id-connect-providers`,
    },
    {
      id: 'id-irsa',
      title: 'IRSA (IAM Roles for Service Accounts)',
      note: 'Needs the OIDC provider above associated with the cluster first.',
      lang: 'bash',
      code: `cat > trust.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::111122223333:oidc-provider/oidc.eks.eu-central-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "oidc.eks.eu-central-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE:sub": "system:serviceaccount:default:my-app",
        "oidc.eks.eu-central-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE:aud": "sts.amazonaws.com"
      }
    }
  }]
}
JSON

aws iam create-role --role-name my-app-irsa --assume-role-policy-document file://trust.json
aws iam attach-role-policy --role-name my-app-irsa --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess`,
    },
    {
      id: 'id-irsa-sa',
      title: 'IRSA ServiceAccount',
      code: `apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-app
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::111122223333:role/my-app-irsa
---
# reference it from the pod spec:
# spec:
#   serviceAccountName: my-app`,
    },
    {
      id: 'id-pod-identity',
      title: 'EKS Pod Identity',
      note: 'No OIDC needed, and the trust policy is identical for every role: trust the pods.eks.amazonaws.com service. Needs the "Amazon EKS Pod Identity Agent" addon on the cluster.',
      lang: 'bash',
      code: `cat > trust.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "pods.eks.amazonaws.com" },
    "Action": ["sts:AssumeRole", "sts:TagSession"]
  }]
}
JSON

aws iam create-role --role-name my-app-pod-identity --assume-role-policy-document file://trust.json
aws iam attach-role-policy --role-name my-app-pod-identity --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess

aws eks create-pod-identity-association \\
  --cluster-name my-cluster \\
  --namespace default \\
  --service-account my-app \\
  --role-arn arn:aws:iam::111122223333:role/my-app-pod-identity

aws eks list-pod-identity-associations --cluster-name my-cluster`,
    },
    {
      id: 'id-pod-identity-sa',
      title: 'Pod Identity ServiceAccount',
      note: 'No annotation needed, the association above is what does the binding.',
      code: `apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-app`,
    },
  ],
};

const storage: Group = {
  id: 'storage',
  title: 'Storage',
  blurb: 'Mount an EBS volume for one pod at a time, or an EFS volume shared across many.',
  snippets: [
    {
      id: 'st-ebs',
      title: 'EBS volume (ReadWriteOnce)',
      note: 'Needs the "Amazon EBS CSI Driver" addon, with a role (IRSA or Pod Identity) attached to its service account carrying AmazonEBSCSIDriverPolicy.',
      code: `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ebs-sc
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
parameters:
  type: gp3
  encrypted: "true"
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-data
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: ebs-sc
  resources:
    requests: { storage: 10Gi }
---
# mount it in a pod:
# spec:
#   containers:
#     - name: app
#       volumeMounts:
#         - name: data
#           mountPath: /data
#   volumes:
#     - name: data
#       persistentVolumeClaim:
#         claimName: my-data`,
    },
    {
      id: 'st-efs',
      title: 'EFS volume (ReadWriteMany, shared)',
      note: 'Needs the "Amazon EFS CSI Driver" addon, AmazonEFSCSIDriverPolicy on its controller service account, and an EFS filesystem with mount targets in the node subnets.',
      code: `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: efs-sc
provisioner: efs.csi.aws.com
parameters:
  provisioningMode: efs-ap
  fileSystemId: fs-0123456789abcdef0
  directoryPerms: "700"
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shared-data
spec:
  accessModes: [ReadWriteMany]
  storageClassName: efs-sc
  resources:
    requests: { storage: 5Gi }`,
    },
  ],
};

const karpenter: Group = {
  id: 'karpenter',
  title: 'Karpenter',
  blurb:
    'Node autoscaling: an EC2NodeClass describes the instances, a NodePool decides when and which ones to launch. Example provisions arm64 (Graviton) spot capacity.',
  snippets: [
    {
      id: 'kp-nodeclass',
      title: 'EC2NodeClass (arm64)',
      code: `apiVersion: karpenter.k8s.aws/v1
kind: EC2NodeClass
metadata:
  name: arm64
spec:
  amiSelectorTerms:
    - alias: al2023@latest
  role: KarpenterNodeRole-my-cluster
  subnetSelectorTerms:
    - tags: { karpenter.sh/discovery: my-cluster }
  securityGroupSelectorTerms:
    - tags: { karpenter.sh/discovery: my-cluster }
  tags: { Project: worldskills }
  detailedMonitoring: true
  metadataOptions:
    httpTokens: required
    httpPutResponseHopLimit: 1
  blockDeviceMappings:
    - deviceName: /dev/xvda
      ebs:
        volumeSize: 50Gi
        volumeType: gp3
        encrypted: true`,
    },
    {
      id: 'kp-nodepool',
      title: 'NodePool (arm64, spot-first)',
      code: `apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: arm64-spot
spec:
  template:
    spec:
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: arm64
      requirements:
        - key: kubernetes.io/arch
          operator: In
          values: [arm64]
        - key: karpenter.sh/capacity-type
          operator: In
          values: [spot, on-demand]
        - key: karpenter.k8s.aws/instance-category
          operator: In
          values: [c, m, r]
  limits:
    cpu: 100
  disruption:
    consolidationPolicy: WhenEmptyOrUnderutilized
    consolidateAfter: 30s`,
    },
  ],
};

const integrations: Group = {
  id: 'service-integrations',
  title: 'AWS service integrations',
  blurb: 'Device telemetry, file imports, ETL schedules and application log delivery from pods.',
  snippets: [
    {
      id: 'integration-identity',
      title: 'ServiceAccount + Pod Identity',
      note: 'Install the Pod Identity agent first (IAM for pods above). ROLE_ARN must trust pods.eks.amazonaws.com with sts:AssumeRole and sts:TagSession, scoped to this cluster, namespace and service account. Attach only the policy needed by the workload below; use a separate account/role for each workload.',
      lang: 'bash',
      code: `kubectl create namespace integrations
kubectl create serviceaccount aws-worker -n integrations
aws eks create-pod-identity-association --cluster-name my-cluster --namespace integrations --service-account aws-worker --role-arn "$ROLE_ARN"`,
    },
    {
      id: 'integration-iot-policy',
      title: 'IoT publisher permissions',
      note: 'Attach to the pod role. The HTTPS publisher uses IAM signing; MQTT clients using X.509 certificates require a separate IoT policy.',
      lang: 'json',
      code: `{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "iot:DescribeEndpoint", "Resource": "*" },
    { "Effect": "Allow", "Action": "iot:Publish", "Resource": "arn:aws:iot:eu-central-1:111122223333:topic/devices/sensor-1/telemetry" }
  ]
}`,
    },
    {
      id: 'integration-iot',
      title: 'IoT telemetry Job',
      note: 'Uses the service account and policy above. A software device is enough to test the rule/Lambda/Firehose path.',
      lang: 'yaml',
      code: `apiVersion: batch/v1
kind: Job
metadata:
  name: iot-publish
  namespace: integrations
spec:
  backoffLimit: 2
  ttlSecondsAfterFinished: 300
  template:
    spec:
      serviceAccountName: aws-worker
      restartPolicy: Never
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      containers:
        - name: publish
          image: public.ecr.aws/aws-cli/aws-cli:2
          command: [/bin/sh, -ec]
          args:
            - |
              endpoint=$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text)
              aws iot-data publish --endpoint-url "https://$endpoint" --topic devices/sensor-1/telemetry --qos 1 --cli-binary-format raw-in-base64-out --payload '{"temperature":23.5}'
          env:
            - { name: AWS_REGION, value: eu-central-1 }
            - { name: AWS_DEFAULT_REGION, value: eu-central-1 }
            - { name: AWS_EC2_METADATA_DISABLED, value: "true" }
            - { name: AWS_PAGER, value: "" }
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits: { cpu: 500m, memory: 256Mi }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: [ALL] }
            seccompProfile: { type: RuntimeDefault }`,
    },
    {
      id: 'integration-transfer',
      title: 'Transfer S3 upload \u2192 processing Job',
      note: 'For an S3-backed Transfer server, consume uploaded objects through S3. Set the completed object key; create one Job per completion event. Pod role needs s3:GetObject on uploads/* (plus kms:Decrypt for SSE-KMS). Replace the worker image with your processor.',
      lang: 'yaml',
      code: `apiVersion: batch/v1
kind: Job
metadata:
  name: process-upload-42
  namespace: integrations
spec:
  backoffLimit: 2
  ttlSecondsAfterFinished: 3600
  template:
    spec:
      serviceAccountName: aws-worker
      restartPolicy: Never
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      initContainers:
        - name: download
          image: public.ecr.aws/aws-cli/aws-cli:2
          args: [s3, cp, "s3://my-transfer-bucket/uploads/report.csv", /data/report.csv, --only-show-errors]
          env:
            - { name: AWS_REGION, value: eu-central-1 }
            - { name: AWS_DEFAULT_REGION, value: eu-central-1 }
            - { name: AWS_EC2_METADATA_DISABLED, value: "true" }
          volumeMounts:
            - { name: data, mountPath: /data }
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits: { cpu: 500m, memory: 256Mi }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: [ALL] }
      containers:
        - name: process
          image: 111122223333.dkr.ecr.eu-central-1.amazonaws.com/file-worker:1
          args: [/data/report.csv]
          volumeMounts:
            - { name: data, mountPath: /data }
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits: { cpu: "1", memory: 512Mi }
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: [ALL] }
      volumes:
        - name: data
          emptyDir: { sizeLimit: 1Gi }`,
    },
    {
      id: 'integration-glue',
      title: 'Glue ETL CronJob',
      note: 'Pod role needs glue:StartJobRun on arn:aws:glue:eu-central-1:111122223333:job/my-etl. The Glue job has its own data-access role and security configuration. Set MaxConcurrentRuns=1 on the Glue job too: Kubernetes concurrencyPolicy only covers the short submission Job.',
      lang: 'yaml',
      code: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: glue-etl
  namespace: integrations
spec:
  schedule: "0 * * * *"
  timeZone: Etc/UTC
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 300
  successfulJobsHistoryLimit: 1
  failedJobsHistoryLimit: 2
  jobTemplate:
    spec:
      backoffLimit: 0
      activeDeadlineSeconds: 120
      template:
        spec:
          serviceAccountName: aws-worker
          restartPolicy: Never
          containers:
            - name: submit
              image: public.ecr.aws/aws-cli/aws-cli:2
              args: [glue, start-job-run, --job-name, my-etl]
              env:
                - { name: AWS_REGION, value: eu-central-1 }
                - { name: AWS_DEFAULT_REGION, value: eu-central-1 }
                - { name: AWS_EC2_METADATA_DISABLED, value: "true" }
              resources:
                requests: { cpu: 100m, memory: 128Mi }
                limits: { cpu: 500m, memory: 256Mi }
              securityContext:
                runAsNonRoot: true
                runAsUser: 1000
                allowPrivilegeEscalation: false
                capabilities: { drop: [ALL] }`,
    },
    {
      id: 'integration-firehose',
      title: 'Fluent Bit \u2192 Firehose',
      note: 'Merge into the existing Fluent Bit ConfigMap and restart its DaemonSet. Associate its ServiceAccount with an IAM role allowing firehose:PutRecordBatch on this stream. Requires a Fluent Bit build with the kinesis_firehose output (AWS for Fluent Bit includes it).',
      lang: 'ini',
      code: `[OUTPUT]
    Name                  kinesis_firehose
    Match                 kube.*
    region                eu-central-1
    delivery_stream       my-firehose
    time_key              timestamp
    auto_retry_requests   true
    Retry_Limit           5`,
    },
  ],
};

export const groups: Group[] = [
  access,
  helpers,
  workloads,
  identity,
  storage,
  karpenter,
  integrations,
];

export default groups;
