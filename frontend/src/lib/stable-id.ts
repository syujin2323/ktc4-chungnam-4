/**
 * 같은 글이면 늘 같은 UUID를 만듭니다. 같은 파일을 다시 넣었을 때 알아보는 데만 쓰고, 보안용이 아닙니다.
 * 128비트 해시(cyrb128, 공개 도메인)를 UUID 모양으로 적고, 버전 자리는 사용자 정의 형식(8)으로 둡니다.
 */
export function stableUuid(key: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  const hex = [h1, h2, h3, h4].map((part) => (part >>> 0).toString(16).padStart(8, "0")).join("");
  // 변형 자리의 앞 두 비트를 10으로 맞춥니다(8~b).
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
