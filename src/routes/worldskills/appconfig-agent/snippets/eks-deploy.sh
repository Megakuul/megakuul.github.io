EKS_CLUSTER=my-cluster
NAMESPACE=default
DEPLOYMENT=my-app
APP_CONTAINER=app
SERVICE_ACCOUNT=appconfig-reader
aws eks update-kubeconfig --name "$EKS_CLUSTER" --region "$AWS_REGION"
eksctl utils associate-iam-oidc-provider --cluster "$EKS_CLUSTER" --region "$AWS_REGION" --approve
eksctl create iamserviceaccount --cluster "$EKS_CLUSTER" --region "$AWS_REGION" --namespace "$NAMESPACE" --name "$SERVICE_ACCOUNT" --role-name "$EKS_CLUSTER-$NAMESPACE-appconfig-reader" --attach-policy-arn "$POLICY_ARN" --approve

# Uses the dedicated service account; attach any additional app permissions to its role.
cat > eks-agent.yaml <<YAML
spec:
  template:
    spec:
      serviceAccountName: $SERVICE_ACCOUNT
      containers:
        - name: $APP_CONTAINER
          env:
            - name: APPCONFIG_PATH
              value: "$CONFIG_PATH"
        - name: appconfig-agent
          image: $AGENT_IMAGE
          env:
            - name: SERVICE_REGION
              value: "$AWS_REGION"
            - name: HTTP_HOST
              value: localhost
            - name: HTTP_PORT
              value: "2772"
            - name: PREFETCH_LIST
              value: "$CONFIG_PATH"
            - name: POLL_INTERVAL
              value: "45s"
            - name: REQUEST_TIMEOUT
              value: "3s"
            - name: LOG_LEVEL
              value: warn
          resources:
            requests: {cpu: 10m, memory: 64Mi}
            limits: {memory: 128Mi}
YAML
kubectl patch deployment "$DEPLOYMENT" -n "$NAMESPACE" --type strategic --patch-file eks-agent.yaml
kubectl rollout status deployment/"$DEPLOYMENT" -n "$NAMESPACE"
kubectl logs -n "$NAMESPACE" deployment/"$DEPLOYMENT" -c appconfig-agent --tail=50
