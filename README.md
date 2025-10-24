# EcoSort
Application that helps with automatic garbage classification (Plastic, metal, cardboard, etc.)

## Requirements
- Node.js
- npm
- Python
- uv
- chocolatey

## How to run
1. Clone the repository:
```bash
git clone https://github.com/anouillz/EcoSort
cd EcoSort
```

2. Set up a .venv in the `backend` folder.

3. Install dependencies:
```bash
cd EcoSort/backend
uv sync
```

4. Run the backend:
```bash
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

5. Run the frontend:
```bash
cd EcoSort/frontend

# Live camera certificate
choco install mkcert
mkcert -install
mkcert ip localhost
# ip+1*.pem to frontend/certs and rename to local-cert.pem and local-key.pem

npm install
npm run dev
```

6. Open [https://localhost:8000](https://localhost:8000) in your browser

## Contributors
- [Lunfeer](https://github.com/Lunfeer)
- [anouillz](https://github.com/anouillz)
- [fylis](https://github.com/fylis)