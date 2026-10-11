import { bool, lit, nullable, num, obj, str } from '../../shared/lib/guard'

export const telemetryShape = obj({ fps: num, dropped: num, width: num, height: num, refresh: num })
export const deviceShape = obj({ id: str, name: str, role: lit('output', 'editor', 'remote', 'agent'), lastSeen: str, online: bool, telemetry: nullable(telemetryShape) })
