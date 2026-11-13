import axios, { type AxiosInstance, type AxiosError } from 'axios'

export class ApiError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const record = error as { code?: string; message?: string; name?: string }
  if (record.code === 'ECONNABORTED' || record.code === 'ERR_CANCELED' || record.name === 'CanceledError') {
    return true
  }
  return typeof record.message === 'string' && /timeout|aborted|canceled|cancelled/i.test(record.message)
}

export async function withRequestTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

export function createClient(
  baseURL: string,
  token: string,
  serviceName: string,
  extraHeaders?: Record<string, string>,
): AxiosInstance {
  const client = axios.create({
    baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...extraHeaders,
    },
  })

  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError<{ msg?: string; message?: string }>) => {
      if (isTimeoutError(error)) {
        throw new ApiError(`${serviceName} 接口超时，请稍后重试或缩短日期`)
      }
      if (!error.response) {
        throw new ApiError(`无法连接${serviceName}服务，请检查 .env.local 里的接口地址`)
      }
      if (error.response.status === 401) {
        throw new ApiError(`${serviceName} token 失效，请修改 .env.local 后重启开发服务`, 401)
      }
      const data = error.response.data
      throw new ApiError(data?.msg || data?.message || '请求失败', error.response.status)
    },
  )

  return client
}

export function unwrapMis<T>(body: { code?: number; msg?: string; data?: T } | null | undefined): T {
  if (!body || body.code !== 200) {
    throw new ApiError(body?.msg || '请求失败')
  }
  return body.data as T
}

export function unwrapArticle<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'code' in body) {
    const record = body as { code?: number; msg?: string; message?: string; data?: T }
    if (record.code !== 200 && record.code !== 0) {
      throw new ApiError(record.msg || record.message || '请求失败')
    }
    if ('data' in record) {
      return record.data as T
    }
  }
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as { data: T }).data
  }
  return body as T
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  return '请求失败'
}
