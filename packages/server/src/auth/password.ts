import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended argon2id parameters for interactive auth.
// @node-rs/argon2 defaults to Argon2id when algorithm is omitted.
const OPTS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS);
}

export function verifyPassword(plain: string, digest: string): Promise<boolean> {
  return verify(digest, plain);
}