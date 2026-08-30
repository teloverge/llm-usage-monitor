# Managed compute

This file is the checked-in registry of Armadai managed hosts. It contains private network and deployment details and must remain in the private repository.

Update a host entry when its identity, hostname, connection endpoint, operating system, or Armadai deployment changes. Never put passwords, private keys, access tokens, or other plaintext secrets here.

## `amd-halo`

This machine is both the current operator workstation and the first managed host.

### Identity

| Field | Value |
| --- | --- |
| Host identity | `amd-halo` |
| Hostname | `amd-halo` |
| System FQDN | `amd-halo` |
| System DNS domain | Not configured |
| Tailnet DNS name | `amd-halo.tail4749d6.ts.net` |
| Tailnet domain | `tail4749d6.ts.net` |
| Operating system | AMD Ryzen AI Developer Platform 1 (`rex`) |
| Architecture | `x86_64` |

### Connection

| Field | Value |
| --- | --- |
| Transport | Standard OpenSSH over Tailscale |
| SSH command | `ssh pfdev@amd-halo.tail4749d6.ts.net` |
| SSH user | `pfdev` |
| SSH port | `22` |
| Tailnet IPv4 | `100.90.1.2` |
| Tailnet IPv6 | `fd7a:115c:a1e0::933b:2c80` |
| Tailscale state | Online |
| Tailscale SSH | Disabled |
| OpenSSH service | Active and enabled |

### Armadai deployment

| Field | Value |
| --- | --- |
| Repository path | `/home/pfdev/dev/armadai` |
| Git remote | `git@github.com:teloverge/armadai.git` |
| Branch | `main` |
| Remote branch | `origin/main` |
| Git revision | `e044a48bbc94a5ea2b57e01322a1ff0998cd9d48` |
| Deployment state | Repository initialized locally; Armadai-managed deployment is not implemented |
| Last inspected | `2026-08-29` in `America/Chicago` |

## `pf-omen`

This Windows workstation is an experimental managed host for the local-LLM Role. OpenSSH authorization from `amd-halo` uses the dedicated remote-release identity declared below.

### Identity

| Field | Value |
| --- | --- |
| Host identity | `pf-omen` |
| Hostname | `PF-Omen` |
| System FQDN | `PF-Omen` |
| System DNS domain | Not configured |
| Tailnet DNS name | `pf-omen.tail4749d6.ts.net` |
| Tailnet domain | `tail4749d6.ts.net` |
| Operating system | Windows 11 Home 25H2, build `26200.9168` |
| Architecture | `x86_64` |

### Connection

| Field | Value |
| --- | --- |
| Transport | Standard OpenSSH over Tailscale |
| SSH command | `ssh -o IdentitiesOnly=yes -i /home/pfdev/.ssh/id_ed25519_from-amd-halo_to-pf-omen_remote-release_20260825 pfdev@pf-omen.tail4749d6.ts.net` |
| SSH user | `pfdev` |
| SSH port | `22` |
| Node command | `C:\Users\pfdev\.vite-plus\js_runtime\node\24.20.0\node.exe` |
| Tailnet IPv4 | `100.90.1.1` |
| Tailnet IPv6 | `fd7a:115c:a1e0::5c3b:9e60` |
| Tailscale state | Online |
| Tailscale SSH | Disabled |
| OpenSSH service | Active and reachable; public-key authorization needs repair |

### Armadai deployment

| Field | Value |
| --- | --- |
| Repository path | Not configured |
| Git remote | Not configured |
| Branch | Not configured |
| Remote branch | Not configured |
| Git revision | Not configured |
| Deployment state | Not bootstrapped; experimental local-LLM declaration recorded |
| Last inspected | `2026-08-29` in `America/Chicago` |
