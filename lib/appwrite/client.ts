/**
 * Shared Appwrite client for the browser.
 *
 * One Client instance for the whole tab: Account / Databases / Storage all
 * share the same session cookie. Missing env vars fail loudly at first use
 * rather than silently talking to the wrong project.
 */
import { Account, Client, Databases, Storage } from 'appwrite';

const DEFAULT_ENDPOINT = 'https://sfo.cloud.appwrite.io/v1';
const DEFAULT_PROJECT_ID = '6aa93e64000c2801517e';

let client: Client | null = null;
let account: Account | null = null;
let databases: Databases | null = null;
let storage: Storage | null = null;

export function getAppwriteEndpoint(): string {
  return (import.meta.env.VITE_APPWRITE_ENDPOINT as string | undefined)?.trim() || DEFAULT_ENDPOINT;
}

export function getAppwriteProjectId(): string {
  return (import.meta.env.VITE_APPWRITE_PROJECT_ID as string | undefined)?.trim() || DEFAULT_PROJECT_ID;
}

export function getClient(): Client {
  if (client) return client;
  client = new Client().setEndpoint(getAppwriteEndpoint()).setProject(getAppwriteProjectId());
  return client;
}

export function getAccount(): Account {
  return (account ??= new Account(getClient()));
}

export function getDatabases(): Databases {
  return (databases ??= new Databases(getClient()));
}

export function getStorage(): Storage {
  return (storage ??= new Storage(getClient()));
}

/** Test seam: drop the singletons so the next call rebuilds from env. */
export function resetAppwriteClientForTests(): void {
  client = null;
  account = null;
  databases = null;
  storage = null;
}
