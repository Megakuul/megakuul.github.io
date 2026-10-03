interface Project {
  title: string;
  description: string;
  published: string;
  type: 'mini' | 'cheatsheet' | 'yappin';
  services: string[];
}

export const projects: Record<string, Project> = {
  'elastic-kvm-wrapper': {
    title: 'Elastic KVM Wrapper ➰',
    description: 'Exploring virtual machines with elastic pricing',
    published: '25.01.2026',
    type: 'mini',
    services: ['ec2', 'vpc'],
  },
  teamevent: {
    title: 'Teamevent 📅',
    description: 'How to burn your money event driven',
    published: '27.01.2026',
    type: 'mini',
    services: ['events'],
  },
  'cloud-trailer': {
    title: 'Cloud Trailer 🚛',
    description: 'Wait, what did I just do?',
    published: '16.02.2026',
    type: 'mini',
    services: ['cloudtrail'],
  },
  'inmemory-rds': {
    title: 'Inmemory RDS 🧠',
    description: "Wait a minute, isn't that just Valkey?",
    published: '18.03.2026',
    type: 'mini',
    services: ['elasticache'],
  },
  'scaler-swag': {
    title: 'Scaler Swag 📈',
    description: 'Kubernetes built by Java developers',
    published: '06.03.2026',
    type: 'mini',
    services: ['ec2', 'autoscaler'],
  },
  'simple-tube': {
    title: 'Simple Tube Service 🧪',
    description: 'Why is message broker just one letter away from "message broken"?',
    published: '23.03.2026',
    type: 'mini',
    services: ['sqs', 'sns'],
  },
  incognito: {
    title: 'Incognito 🥸',
    description: "Guys we haven't read the OIDC spec either",
    published: '30.04.2026',
    type: 'mini',
    services: ['cognito'],
  },
  watchout: {
    title: 'Watch Out 🙈',
    description: 'Who is grafana? should I know this guy?',
    published: '10.08.2026',
    type: 'mini',
    services: ['cloudwatch'],
  },
  'expensive-filesystem': {
    title: 'Expensive Filesystem 💲',
    description: 'Burn money with bleeding-edge NFS technology',
    published: '08.09.2026',
    type: 'mini',
    services: ['efs'],
  },
  'pipe-plumber': {
    title: 'Pipe Plumber 🪠',
    description: 'Building a CI/CD pipeline to deploy this website',
    published: '08.01.2026',
    type: 'yappin',
    services: ['s3', 'acm', 'cloudfront', 'codebuild', 'cli', 'codepipeline'],
  },
  // renamed for pascal's sake
  'please-open-the-door': {
    title: 'Please open the door 🔒',
    description: 'How to authenticate with aws cli',
    published: '09.01.2026',
    type: 'yappin',
    services: ['cli', 'iam', 'sts'],
  },
  'the-reason-aws-is-good': {
    title: 'The reason AWS is good 🗿',
    description: 'Why the AWS permission system is crazy good',
    published: '18.01.2026',
    type: 'yappin',
    services: ['iam', 'sts'],
  },
  paranoia: {
    title: 'Paranoia 🛠️',
    description: 'Parameterstore vs Secrets Manager ⚔️ FIGHT',
    published: '27.01.2026',
    type: 'yappin',
    services: ['ssm', 'secrets-manager'],
  },
  networking: {
    title: 'Networking 🌐',
    description: 'VPC is not that hard',
    published: '30.01.2026',
    type: 'yappin',
    services: ['vpc'],
  },
  'transitive-gateway': {
    title: 'Transitive Gateway 💫',
    description: 'Route everything everywhere',
    published: '02.02.2026',
    type: 'yappin',
    services: ['vpc'],
  },
  'client-vpn': {
    title: 'Client VPN 💸',
    description: 'Make OpenVPN Expensive Again',
    published: '07.02.2026',
    type: 'yappin',
    services: ['vpc'],
  },
  'edgy-functions': {
    title: 'Edgy Functions 🎱',
    description: 'Unleash the power of servers that are less',
    published: '18.02.2026',
    type: 'yappin',
    services: ['lambda'],
  },
  'api-gate': {
    title: 'api-gate 🍝',
    description: 'A service created with the dark power of spaghetti code',
    published: '26.02.2026',
    type: 'yappin',
    services: ['api-gateway'],
  },
  'elite-kubernetes-shenanigans': {
    title: 'Elite Kubernetes Shenanigans 🦅',
    description: 'Not even AWS dared to call it "Simple Kubernetes Service"',
    published: '25.04.2026',
    type: 'yappin',
    services: ['eks'],
  },
  'how-about-a-magic-trick': {
    title: 'How about a magic trick 🎩',
    description: 'Some neat magictricks for latenight debugging sessions',
    published: '15.01.2026',
    type: 'cheatsheet',
    services: ['cli', 'ssm'],
  },
  wellarchitecter: {
    title: 'Wellarchitecter 🧱',
    description: 'AWS best practice buzzwords',
    published: '23.01.2026',
    type: 'cheatsheet',
    services: ['iam', 'sts', 'vpc'],
  },
};

export default projects;
