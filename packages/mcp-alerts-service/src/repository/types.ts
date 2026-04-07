export type AlertExecutionRecord = {
  source_scope: string | null;
  source_table: string | null;
  rule_id: string | null;
  rule_name: string | null;
  advisory_id: string | null;
  vessel_id: string | null;
  vessel_mapping_name: string | null;
  vessel_name: string | null;
  acknowledge_status: string | null;
  observant_type: string | null;
  executed_at: string | null;
  live_value: string | null;
  live_value_unit: string | null;
  machine_type: string | null;
  company_name: string | null;
  summary: string | null;
  payload_json: unknown | null;
};

export type AlertRuleConfigRecord = {
  rule_config_id: string | null;
  rule_config_name: string | null;
  description: string | null;
  condition: unknown | null;
  enabled: boolean | null;
  parameter_id: string | null;
  parameter_name: string | null;
  parameter_machine_name: string | null;
  parameter_unit: string | null;
  color: string | null;
  send_notifications: unknown | null;
  rule_type: string | null;
};

export type AlertRuleRecord = {
  source_scope: string | null;
  rule_id: string | null;
  rule_name: string | null;
  description: string | null;
  enabled: boolean | null;
  company_name: string | null;
  user_id: string | null;
  vessel_id: string | null;
  vessel_mapping_name: string | null;
  vessel_name: string | null;
  raw_rule_refs: string[];
  evaluation_factor: unknown | null;
  evaluation_method: unknown | null;
  rule_configs: AlertRuleConfigRecord[];
};

export type GetRecentExecuteAlertsInput = {
  tenant: string;
  limit: number;
  ruleId?: string;
  status?: string;
  since?: string;
};

export type DescribeRulesInput = {
  tenant: string;
  limit: number;
  ruleId?: string;
  enabledOnly?: boolean;
};

export interface AlertsRepository {
  getRecentExecuteAlerts(input: GetRecentExecuteAlertsInput): Promise<AlertExecutionRecord[]>;
  describeRules(input: DescribeRulesInput): Promise<AlertRuleRecord[]>;
}
