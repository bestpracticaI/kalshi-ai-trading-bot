declare module "web3.prc" {
  export function prices(): Promise<Record<string, unknown>>;
}
