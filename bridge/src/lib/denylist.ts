const DENIED_PATTERNS = [
  'rm -rf',
  'rm -r /',
  'sudo rm',
  'format',
  'mkfs',
  'dd if=',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  ':(){:|:&};:',
  '> /dev/sda',
  'chmod 777 /',
  'chown -R',
  'iptables -F',
  'ufw disable',
  'drop table',
  'drop database',
  'truncate',
]

export function isDeniedCommand(command: string): boolean {
  const lower = command.toLowerCase()
  return DENIED_PATTERNS.some((p) => lower.includes(p.toLowerCase()))
}
