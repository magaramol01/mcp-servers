import { connectPostgres } from "@mcpkit/utils";
import { getTenantPostgresUrl, parseRuleRefs, qualifyTableName } from "../tools/shared.js";
import type {
  AlertExecutionRecord,
  AlertRuleConfigRecord,
  AlertRuleRecord,
  AlertsRepository,
  DescribeRulesInput,
  GetRecentExecuteAlertsInput,
} from "./types.js";

const RULE_ENGINE_SCHEMA = "shipping_db";

const TABLE_NAMES = {
  ship: "ship",
  stdRuleBlocks: "std_ruleblocks",
  stdRuleConfigs: "std_ruleconfigs",
  standardParameters: "standardparameters",
  stdTriggeredOutcomesToday: "std_triggeredoutcomestoday",
  stdTriggeredOutcomesHistory: "std_triggeredoutcomeshistory",
} as const;

type PostgresAlertsRepositoryConfig = {
  basePostgresUrl: string;
};

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

function toNullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();

    if (["true", "t", "1", "yes", "y"].includes(normalizedValue)) {
      return true;
    }

    if (["false", "f", "0", "no", "n"].includes(normalizedValue)) {
      return false;
    }
  }

  return Boolean(value);
}

function toIsoTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(String(value));

  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toISOString();
}

function toRuleConfigs(value: unknown): AlertRuleConfigRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    const record = typeof entry === "object" && entry !== null ? entry : {};

    return {
      rule_config_id: toNullableString(
        "rule_config_id" in record ? (record as { rule_config_id: unknown }).rule_config_id : null,
      ),
      rule_config_name: toNullableString(
        "rule_config_name" in record
          ? (record as { rule_config_name: unknown }).rule_config_name
          : null,
      ),
      description: toNullableString(
        "description" in record ? (record as { description: unknown }).description : null,
      ),
      condition:
        "condition" in record ? (record as { condition: unknown }).condition ?? null : null,
      enabled: toNullableBoolean(
        "enabled" in record ? (record as { enabled: unknown }).enabled : null,
      ),
      parameter_id: toNullableString(
        "parameter_id" in record ? (record as { parameter_id: unknown }).parameter_id : null,
      ),
      parameter_name: toNullableString(
        "parameter_name" in record ? (record as { parameter_name: unknown }).parameter_name : null,
      ),
      parameter_machine_name: toNullableString(
        "parameter_machine_name" in record
          ? (record as { parameter_machine_name: unknown }).parameter_machine_name
          : null,
      ),
      parameter_unit: toNullableString(
        "parameter_unit" in record ? (record as { parameter_unit: unknown }).parameter_unit : null,
      ),
      color: toNullableString("color" in record ? (record as { color: unknown }).color : null),
      send_notifications:
        "send_notifications" in record
          ? (record as { send_notifications: unknown }).send_notifications ?? null
          : null,
      rule_type: toNullableString(
        "rule_type" in record ? (record as { rule_type: unknown }).rule_type : null,
      ),
    };
  });
}

class PostgresAlertsRepository implements AlertsRepository {
  private readonly shipTable: string;
  private readonly stdRuleBlocksTable: string;
  private readonly stdRuleConfigsTable: string;
  private readonly standardParametersTable: string;
  private readonly stdTriggeredOutcomesTodayTable: string;
  private readonly stdTriggeredOutcomesHistoryTable: string;

  constructor(private readonly config: PostgresAlertsRepositoryConfig) {
    this.shipTable = qualifyTableName(RULE_ENGINE_SCHEMA, TABLE_NAMES.ship);
    this.stdRuleBlocksTable = qualifyTableName(RULE_ENGINE_SCHEMA, TABLE_NAMES.stdRuleBlocks);
    this.stdRuleConfigsTable = qualifyTableName(RULE_ENGINE_SCHEMA, TABLE_NAMES.stdRuleConfigs);
    this.standardParametersTable = qualifyTableName(
      RULE_ENGINE_SCHEMA,
      TABLE_NAMES.standardParameters,
    );
    this.stdTriggeredOutcomesTodayTable = qualifyTableName(
      RULE_ENGINE_SCHEMA,
      TABLE_NAMES.stdTriggeredOutcomesToday,
    );
    this.stdTriggeredOutcomesHistoryTable = qualifyTableName(
      RULE_ENGINE_SCHEMA,
      TABLE_NAMES.stdTriggeredOutcomesHistory,
    );
  }

  async getRecentExecuteAlerts(
    input: GetRecentExecuteAlertsInput,
  ): Promise<AlertExecutionRecord[]> {
    const tenantPostgresUrl = getTenantPostgresUrl(this.config.basePostgresUrl, input.tenant);
    const pool = await connectPostgres(tenantPostgresUrl);
    const values: unknown[] = [];
    const whereClauses: string[] = [];

    if (input.ruleId) {
      values.push(input.ruleId);
      whereClauses.push(`rule_id = $${values.length}`);
    }

    if (input.status) {
      values.push(input.status);
      whereClauses.push(`acknowledge_status::text = $${values.length}`);
    }

    if (input.since) {
      values.push(input.since);
      whereClauses.push(`executed_at >= $${values.length}`);
    }

    values.push(input.limit);

    const query = `
      WITH combined_alerts AS (
        SELECT
          1 AS source_priority,
          'standard'::text AS source_scope,
          '${TABLE_NAMES.stdTriggeredOutcomesToday}'::text AS source_table,
          alert.rulekey::text AS rule_id,
          rb.name AS rule_name,
          alert.advisorykey::text AS advisory_id,
          alert.vesselid::text AS vessel_id,
          ship.mappingname AS vessel_mapping_name,
          ship.name AS vessel_name,
          alert.acknowledgestatus::text AS acknowledge_status,
          alert.observanttype::text AS observant_type,
          alert."timestamp" AS executed_at,
          alert.livevalue::text AS live_value,
          alert.livevalueunit::text AS live_value_unit,
          alert.machinetype::text AS machine_type,
          alert.companyname::text AS company_name,
          alert.observantmessage::text AS summary,
          alert.data AS payload_json
        FROM ${this.stdTriggeredOutcomesTodayTable} AS alert
        LEFT JOIN ${this.stdRuleBlocksTable} AS rb
          ON rb.id = alert.rulekey
        LEFT JOIN ${this.shipTable} AS ship
          ON ship.id = alert.vesselid

        UNION ALL

        SELECT
          2 AS source_priority,
          'standard'::text AS source_scope,
          '${TABLE_NAMES.stdTriggeredOutcomesHistory}'::text AS source_table,
          alert.rulekey::text AS rule_id,
          rb.name AS rule_name,
          alert.advisorykey::text AS advisory_id,
          alert.vesselid::text AS vessel_id,
          ship.mappingname AS vessel_mapping_name,
          ship.name AS vessel_name,
          alert.acknowledgestatus::text AS acknowledge_status,
          alert.observanttype::text AS observant_type,
          alert."timestamp" AS executed_at,
          alert.livevalue::text AS live_value,
          alert.livevalueunit::text AS live_value_unit,
          alert.machinetype::text AS machine_type,
          alert.companyname::text AS company_name,
          alert.observantmessage::text AS summary,
          alert.data AS payload_json
        FROM ${this.stdTriggeredOutcomesHistoryTable} AS alert
        LEFT JOIN ${this.stdRuleBlocksTable} AS rb
          ON rb.id = alert.rulekey
        LEFT JOIN ${this.shipTable} AS ship
          ON ship.id = alert.vesselid
      ),
      deduplicated_alerts AS (
        SELECT
          source_scope,
          source_table,
          rule_id,
          rule_name,
          advisory_id,
          vessel_id,
          vessel_mapping_name,
          vessel_name,
          acknowledge_status,
          observant_type,
          executed_at,
          live_value,
          live_value_unit,
          machine_type,
          company_name,
          summary,
          payload_json,
          ROW_NUMBER() OVER (
            PARTITION BY
              source_scope,
              rule_id,
              advisory_id,
              vessel_id,
              executed_at,
              summary,
              live_value,
              live_value_unit,
              machine_type,
              company_name
            ORDER BY source_priority ASC
          ) AS row_number
        FROM combined_alerts
      )
      SELECT
        source_scope,
        source_table,
        rule_id,
        rule_name,
        advisory_id,
        vessel_id,
        vessel_mapping_name,
        vessel_name,
        acknowledge_status,
        observant_type,
        executed_at,
        live_value,
        live_value_unit,
        machine_type,
        company_name,
        summary,
        payload_json
      FROM deduplicated_alerts
      WHERE row_number = 1
      ${whereClauses.length > 0 ? `AND ${whereClauses.join(" AND ")}` : ""}
      ORDER BY executed_at DESC NULLS LAST, advisory_id DESC NULLS LAST, rule_id DESC NULLS LAST
      LIMIT $${values.length}
    `;

    const { rows } = await pool.query(query, values);

    return rows.map((row) => ({
      source_scope: toNullableString(row.source_scope),
      source_table: toNullableString(row.source_table),
      rule_id: toNullableString(row.rule_id),
      rule_name: toNullableString(row.rule_name),
      advisory_id: toNullableString(row.advisory_id),
      vessel_id: toNullableString(row.vessel_id),
      vessel_mapping_name: toNullableString(row.vessel_mapping_name),
      vessel_name: toNullableString(row.vessel_name),
      acknowledge_status: toNullableString(row.acknowledge_status),
      observant_type: toNullableString(row.observant_type),
      executed_at: toIsoTimestamp(row.executed_at),
      live_value: toNullableString(row.live_value),
      live_value_unit: toNullableString(row.live_value_unit),
      machine_type: toNullableString(row.machine_type),
      company_name: toNullableString(row.company_name),
      summary: toNullableString(row.summary),
      payload_json: row.payload_json ?? null,
    }));
  }

  async describeRules(input: DescribeRulesInput): Promise<AlertRuleRecord[]> {
    const tenantPostgresUrl = getTenantPostgresUrl(this.config.basePostgresUrl, input.tenant);
    const pool = await connectPostgres(tenantPostgresUrl);
    const values: unknown[] = [];
    const whereClauses: string[] = [];

    if (input.ruleId) {
      values.push(input.ruleId);
      whereClauses.push(`rule_id = $${values.length}`);
    }

    if (input.enabledOnly) {
      whereClauses.push("enabled = TRUE");
    }

    values.push(input.limit);

    const filterClause =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const query = `
      WITH combined_rules AS (
        SELECT
          'standard'::text AS source_scope,
          rb.id::text AS rule_id,
          rb.name AS rule_name,
          rb.description,
          rb.companyname AS company_name,
          rb.evaluationfactor AS evaluation_factor,
          rb.evaluationmethod AS evaluation_method,
          rb.isactivated AS enabled,
          rb.userid::text AS user_id,
          rb.vesselid::text AS vessel_id,
          ship.mappingname AS vessel_mapping_name,
          ship.name AS vessel_name,
          rb.rules AS raw_rule_refs,
          rc.id::text AS rule_config_id,
          rc.rulename AS rule_config_name,
          rc.description AS rule_config_description,
          rc.condition AS rule_condition,
          rc.isactive AS rule_config_enabled,
          rc.parameterid::text AS parameter_id,
          param.name AS parameter_name,
          param.machinename AS parameter_machine_name,
          param.unit AS parameter_unit,
          rc.color,
          rc.notifications AS send_notifications,
          rc.ruletype AS rule_type
        FROM ${this.stdRuleBlocksTable} AS rb
        JOIN ${this.shipTable} AS ship
          ON ship.id = rb.vesselid
        LEFT JOIN LATERAL unnest(string_to_array(rb.rules, ',')) AS ref(raw_rule_ref)
          ON TRUE
        LEFT JOIN ${this.stdRuleConfigsTable} AS rc
          ON rc.id = CASE
            WHEN TRIM(regexp_replace(ref.raw_rule_ref, '[^0-9]', '', 'g')) <> ''
              THEN CAST(regexp_replace(ref.raw_rule_ref, '[^0-9]', '', 'g') AS INTEGER)
            ELSE NULL
          END
          AND rc."isDeleted" = false
        LEFT JOIN ${this.standardParametersTable} AS param
          ON param.id = rc.parameterid
        WHERE rb."isDeleted" = false
      )
      SELECT
        source_scope,
        rule_id,
        rule_name,
        description,
        company_name,
        enabled,
        user_id,
        vessel_id,
        vessel_mapping_name,
        vessel_name,
        raw_rule_refs,
        evaluation_factor,
        evaluation_method,
        COALESCE(
          jsonb_agg(
            DISTINCT jsonb_build_object(
              'rule_config_id', rule_config_id,
              'rule_config_name', rule_config_name,
              'description', rule_config_description,
              'condition', rule_condition,
              'enabled', rule_config_enabled,
              'parameter_id', parameter_id,
              'parameter_name', parameter_name,
              'parameter_machine_name', parameter_machine_name,
              'parameter_unit', parameter_unit,
              'color', color,
              'send_notifications', send_notifications,
              'rule_type', rule_type
            )
          ) FILTER (WHERE rule_config_id IS NOT NULL),
          '[]'::jsonb
        ) AS rule_configs
      FROM combined_rules
      ${filterClause}
      GROUP BY
        source_scope,
        rule_id,
        rule_name,
        description,
        company_name,
        enabled,
        user_id,
        vessel_id,
        vessel_mapping_name,
        vessel_name,
        raw_rule_refs,
        evaluation_factor,
        evaluation_method
      ORDER BY source_scope ASC, enabled DESC, rule_name ASC NULLS LAST, rule_id ASC
      LIMIT $${values.length}
    `;

    const { rows } = await pool.query(query, values);

    return rows.map((row) => ({
      source_scope: toNullableString(row.source_scope),
      rule_id: toNullableString(row.rule_id),
      rule_name: toNullableString(row.rule_name),
      description: toNullableString(row.description),
      enabled: toNullableBoolean(row.enabled),
      company_name: toNullableString(row.company_name),
      user_id: toNullableString(row.user_id),
      vessel_id: toNullableString(row.vessel_id),
      vessel_mapping_name: toNullableString(row.vessel_mapping_name),
      vessel_name: toNullableString(row.vessel_name),
      raw_rule_refs: parseRuleRefs(row.raw_rule_refs),
      evaluation_factor: row.evaluation_factor ?? null,
      evaluation_method: row.evaluation_method ?? null,
      rule_configs: toRuleConfigs(row.rule_configs),
    }));
  }
}

export function createPostgresAlertsRepository(
  config: PostgresAlertsRepositoryConfig,
): AlertsRepository {
  return new PostgresAlertsRepository(config);
}
