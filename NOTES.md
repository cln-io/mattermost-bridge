docker run --rm mattermost-bridge:latest find /app -type f

npx ts-node src/index.ts



docker run --name mm1 -d --publish 8065:8065 --add-host dockerhost:127.0.0.1 mattermost/mattermost-preview
docker run --name mm2 -d --publish 9065:8065 --add-host dockerhost:127.0.0.1 mattermost/mattermost-preview

