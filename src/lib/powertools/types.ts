export interface EnvVariable {
  name: string;
  example: string;
  required: boolean;
  default?: string | number;
  hint?: string;
}

// Resource properties and intrinsic functions vary by AWS service.
export interface CloudFormationTemplate {
  Parameters: Record<string, { Type: string; Default?: any; [key: string]: any }>;
  Resources: Record<string, { Type: string; Properties?: Record<string, any>; [key: string]: any }>;
  Conditions?: Record<string, any>;
  Outputs?: Record<string, any>;
  [key: string]: any;
}

export interface ToolDefinition {
  id: string;
  title: string;
  env?: EnvVariable[];
  templateName?: string;
  template?: CloudFormationTemplate;
  policy?: Record<string, unknown>;
  command?: string;
  cli?: 'security';
}

export interface DefinitionGroup {
  id: string;
  title: string;
  recipes: ToolDefinition[];
}

export interface Recipe {
  id: string;
  title: string;
  env?: EnvVariable[];
  command?: string;
  cliCommand?: string;
  templateFile?: string;
  cfnTagNote?: string | null;
  resourceTemplate?: CloudFormationTemplate;
  document?: CloudFormationTemplate | Record<string, unknown>;
  documentTitle?: string;
}

export interface ToolGroup {
  id: string;
  title: string;
  recipes: Recipe[];
}
