/**
 * Email/password auth against Appwrite Account.
 *
 * Session cookies live on the Appwrite endpoint; the Web SDK attaches them on
 * subsequent Account / Databases / Storage calls. Callers never see the secret.
 */
import { ID, type Models } from 'appwrite';
import { getAccount } from './client';

export type AuthUser = Models.User<Models.Preferences>;

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    return await getAccount().get();
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in');
  return user;
}

export async function signUp(email: string, password: string, name?: string): Promise<AuthUser> {
  await getAccount().create({
    userId: ID.unique(),
    email: email.trim(),
    password,
    name: name?.trim() || undefined,
  });
  await getAccount().createEmailPasswordSession({ email: email.trim(), password });
  return getAccount().get();
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  await getAccount().createEmailPasswordSession({ email: email.trim(), password });
  return getAccount().get();
}

export async function signOut(): Promise<void> {
  try {
    await getAccount().deleteSession({ sessionId: 'current' });
  } catch {
    // Already signed out, or the session expired -- either way the page should
    // treat the user as anonymous.
  }
}
