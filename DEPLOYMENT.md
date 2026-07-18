# Docker và Watchtower

CI/CD build hai image và publish lên GitHub Container Registry (GHCR):

- `ghcr.io/creampuffai/peerstudy-backend`
- `ghcr.io/creampuffai/peerstudy-frontend`

Package được tạo tự động ở lần chạy workflow đầu tiên có quyền `packages: write`. Workflow chạy test/lint backend, build frontend, sau đó chỉ publish khi push vào `main` hoặc chạy thủ công.

## Chuẩn bị trên VPS

1. Tạo GitHub PAT classic có quyền `read:packages`, rồi đăng nhập GHCR dưới đúng user sẽ chạy Docker:

   ```bash
   echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
   ```

2. Copy `docker-compose.yml` và `.env.example` lên VPS, đổi tên `.env.example` thành `.env`, rồi chỉnh `GHCR_NAMESPACE` nếu owner khác `creampuffai`.

3. Khởi chạy:

   ```bash
   docker compose pull
   docker compose up -d
   docker compose ps
   ```

Watchtower chỉ theo dõi backend/frontend vì `--label-enable`; nó kiểm tra mỗi 300 giây, tự thay container khi tag `latest` có digest mới và xóa image cũ. Nó dùng Docker socket và file `/root/.docker/config.json`, vì vậy file Docker config phải tồn tại trước khi chạy Compose.

Ứng dụng sẽ có tại `http://YOUR_VPS/`; `/api/*` được Nginx chuyển tiếp đến FastAPI và `/health` chuyển tiếp đến backend.

## Lưu ý GHCR

Nếu package GHCR đang private, VPS cần đăng nhập GHCR như trên. Nếu muốn VPS pull không cần credentials, có thể chuyển visibility của từng package sang public trong phần Package settings của GitHub.

