import {
  createOAuthState,
  githubConnection,
  githubTokenEnc,
  saveGithubConnection,
  takeOAuthState,
} from "@turbineh/db";
import { github, type GitHub } from "@turbineh/engine";
import { decrypt, encrypt } from "@turbineh/shared";
import { db } from "./db";
import { env } from "./env";
import { CALLBACK_PATH, type OAuthDeps } from "./github-oauth";

/** Production wiring of the GitHub connection (database, encryption key, OAuth app). */
export const appUrl = () => env.BETTER_AUTH_URL.replace(/\/$/, "");

export function oauthDeps(): OAuthDeps {
  return {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    redirectUri: `${appUrl()}${CALLBACK_PATH}`,
    seal: (p) => encrypt(p, env.DELIVERY_TOKEN_KEY),
    open: (s) => decrypt(s, env.DELIVERY_TOKEN_KEY),
    saveState: (s) => createOAuthState(db, s),
    takeState: (h) => takeOAuthState(db, h),
    saveConnection: (c) => saveGithubConnection(db, c),
    fetch,
  };
}

/** The workspace's GitHub token (decrypted in memory for one request), or null when not connected. */
export async function workspaceToken(ownerId: string): Promise<string | null> {
  const enc = await githubTokenEnc(db, ownerId);
  if (!enc) return null;
  try {
    return decrypt(enc, env.DELIVERY_TOKEN_KEY);
  } catch {
    return null; // key rotated: the user connects again
  }
}

/** A GitHub client for the workspace's connected account, or an anonymous one (public repositories only). */
export async function workspaceGitHub(
  ownerId: string,
): Promise<{ gh: GitHub; connected: boolean; privateRepos: boolean }> {
  const [token, conn] = await Promise.all([workspaceToken(ownerId), githubConnection(db, ownerId)]);
  return {
    gh: github(token),
    connected: Boolean(token),
    privateRepos: Boolean(token && conn?.privateRepos),
  };
}
