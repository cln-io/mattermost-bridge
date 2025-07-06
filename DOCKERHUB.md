# Mattermost Bridge

Multi-architecture Docker image for bridging messages between Mattermost instances.

## Quick Start

```bash
docker pull clnio/mattermost-bridge:latest
docker run --env-file .env clnio/mattermost-bridge:latest
```

## Supported Architectures

- `linux/amd64` - Intel/AMD 64-bit
- `linux/arm64` - ARM 64-bit (Apple Silicon, AWS Graviton, etc.)

## Required Environment Variables

```env
# Source Instance
MATTERMOST_LEFT_NAME=SourceServer
MATTERMOST_LEFT_TEAM=team-name
MATTERMOST_LEFT_SERVER=https://source.mattermost.com
MATTERMOST_LEFT_USERNAME=user@example.com
MATTERMOST_LEFT_PASSWORD_B64=base64_encoded_password
MATTERMOST_LEFT_MFA_SEED=optional_mfa_seed

# Target Instance
MATTERMOST_RIGHT_NAME=TargetServer
MATTERMOST_RIGHT_TEAM=team-name
MATTERMOST_RIGHT_SERVER=https://target.mattermost.com
MATTERMOST_RIGHT_USERNAME=user@example.com
MATTERMOST_RIGHT_PASSWORD_B64=base64_encoded_password
MATTERMOST_RIGHT_MFA_SEED=optional_mfa_seed

# Bridge Configuration
SOURCE_CHANNEL_ID=channel_id_from_source
TARGET_CHANNEL_ID=channel_id_from_target
```

## Docker Compose

```yaml
version: '3.8'
services:
  mattermost-bridge:
    image: clnio/mattermost-bridge:latest
    environment:
      MATTERMOST_LEFT_NAME: Source
      MATTERMOST_LEFT_TEAM: team
      MATTERMOST_LEFT_SERVER: https://source.example.com
      # ... (see GitHub for full example)
```

## Features

- **Cross-server messaging** between Mattermost instances
- **File attachment** forwarding
- **Profile picture** synchronization
- **MFA/2FA** authentication support
- **Email domain filtering**
- **Automatic reconnection** on network issues
- **Health monitoring** via heartbeat URLs

## Tags

- `latest` - Latest stable release
- `v*.*.*` - Specific version releases
- `main-*` - Development builds

## Links

- **GitHub Repository**: https://github.com/cln-io/mattermost-bridge
- **Documentation**: https://github.com/cln-io/mattermost-bridge#readme
- **Issues**: https://github.com/cln-io/mattermost-bridge/issues

## License

MIT - See [GitHub repository](https://github.com/cln-io/mattermost-bridge) for details.