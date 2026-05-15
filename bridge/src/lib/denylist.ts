const DENIED_SUBSTRINGS = [
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
  'chown -r',
  'iptables -f',
  'ufw disable',
  'drop database',
]

const DENIED_REGEXES = [
  /\brm\s*(-[rRfF]+\s*)+/i,
  /\bformat\b/i,
  /\bdrop\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bDELETE\s+FROM\b(?![\s\S]*\bWHERE\b)/i,
]

export function isDeniedCommand(command: string): boolean {
  const normalized = command.normalize('NFKC')
  const lower = normalized.toLowerCase()
  return (
    DENIED_SUBSTRINGS.some((p) => lower.includes(p)) ||
    DENIED_REGEXES.some((pattern) => pattern.test(normalized))
  )
}
