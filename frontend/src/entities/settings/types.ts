/** Agent permission toggles (docs/mcp-plan.md "Safety and control"). All off by default. */
export interface AgentSettings {
  agentMayPreview: boolean
  agentMayGoLive: boolean
  /** lets an agent apply its own draft (MCP draft_apply); older servers leave it out */
  agentMayApply?: boolean
  /** (§15) the backdrop MCP tools write straight to the live scene instead of the agent's draft */
  agentLiveEdits?: boolean
}
