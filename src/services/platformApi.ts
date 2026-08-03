export interface ApiError extends Error {
  status?: number;
  code?: string;
}

const API_BASE = '/api/v1';

export async function platformApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error: ApiError = new Error(body.message || '请求失败');
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return response.json() as Promise<T>;
}

export interface CurrentUser {
  id: string;
  employeeId: string;
  name: string;
  roles: Array<'assistant' | 'leader' | 'manager' | 'admin'>;
  teams: string[];
}

export const getCurrentUser = () => platformApi<CurrentUser>('/auth/me');
export const getDashboardOverview = () => platformApi('/dashboard/overview');
export const getIntegrationStatus = () => platformApi('/integration/status');
