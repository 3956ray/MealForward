export interface TestnetStatus {
  chainId: 10143
  network: 'Monad Testnet'
  latestBlock: string
  checkedAt: string
  contractDeployed: false
}

export class CheckFailure extends Error {}

const messages: Record<string, string> = {
  LOCAL_RATE_LIMITED: '检查过于频繁，请60秒后主动重试。',
  CHECK_IN_PROGRESS: '已有检查进行中，请1秒后再查看。',
  UPSTREAM_RATE_LIMITED: '测试网服务暂时限流，请稍后主动重试。',
  CONFIG_UNAVAILABLE: '测试网连接尚未配置或配置不可用，请联系维护者。',
  UPSTREAM_TIMEOUT: '本次未取得结果，可稍后主动重试。',
  NETWORK_MISMATCH: '当前连接不是所需测试网，请联系维护者。',
}

export async function checkTestnet(signal: AbortSignal): Promise<TestnetStatus> {
  const response = await fetch('/api/v1/testnet/status', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
  })
  const data = await response.json()
  if (!response.ok) throw new CheckFailure(messages[data?.error?.code] ?? '本次测试网读取失败，请稍后主动重试。')
  if (data?.chainId !== 10143 || data.network !== 'Monad Testnet' || data.contractDeployed !== false
      || typeof data.latestBlock !== 'string' || !/^(0|[1-9][0-9]*)$/.test(data.latestBlock)
      || typeof data.checkedAt !== 'string' || !data.checkedAt.endsWith('Z') || !Number.isFinite(Date.parse(data.checkedAt))) {
    throw new CheckFailure('本次测试网返回的数据无效，请稍后主动重试。')
  }
  return { chainId: 10143, network: 'Monad Testnet', latestBlock: data.latestBlock,
    checkedAt: data.checkedAt, contractDeployed: false }
}
