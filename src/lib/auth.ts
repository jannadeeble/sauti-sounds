import type { AppUser } from '../types'
import { apiFetch, apiPost } from './api'

export interface AuthSessionResponse {
  authenticated: boolean
  user: AppUser | null
  canRegister: boolean
  userCount: number
  maxUsers: number
  requiresInviteCode: boolean
}

export interface AuthLoginPayload {
  email: string
  password: string
}

export interface AuthRegisterPayload {
  email: string
  password: string
  name: string
  inviteCode?: string
}

export async function getAuthSession(): Promise<AuthSessionResponse> {
  return apiFetch<AuthSessionResponse>('/api/auth/session')
}

export async function loginAuth(payload: AuthLoginPayload): Promise<AuthSessionResponse> {
  return apiPost<AuthSessionResponse>('/api/auth/login', payload)
}

export async function registerAuth(payload: AuthRegisterPayload): Promise<AuthSessionResponse> {
  return apiPost<AuthSessionResponse>('/api/auth/register', payload)
}

export async function logoutAuth(): Promise<AuthSessionResponse> {
  return apiPost<AuthSessionResponse>('/api/auth/logout')
}
