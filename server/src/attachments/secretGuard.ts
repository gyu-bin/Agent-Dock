/**
 * Secret / credential filename guard — default block.
 */

const SECRET_NAME_PATTERNS: RegExp[] = [
  /^\.env$/,
  /^\.env\..+$/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_rsa$/i,
  /^id_rsa\.pub$/i,
  /^id_ed25519$/i,
  /^id_ed25519\.pub$/i,
  /^credentials/i,
  /^secrets?/i,
  /\.p12$/i,
  /\.pfx$/i,
  /aws[_-]?credentials/i,
]

export function isSecretFileName(name: string): boolean {
  const base = name.split(/[/\\]/).pop() ?? name
  return SECRET_NAME_PATTERNS.some((re) => re.test(base))
}

export function secretFileUserMessage(name: string): string {
  return `보안상 "${name}" 같은 비밀/인증 파일은 기본으로 첨부할 수 없습니다.`
}
