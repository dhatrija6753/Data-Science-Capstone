# ⚡ SplitSmart

> **Scan. Split. Save.** — The smart grocery bill splitter for DMV-area students.

SplitSmart lets you photograph a grocery receipt, automatically extract every line item using AI, split the bill with friends in seconds, and see exactly which store in the DMV would have saved you the most money.

---

## 📱 Features

- **Receipt Scanning** — Point your camera at any receipt. AI reads the store name, every item, price, tax, and total automatically.
- **Smart Bill Splitting** — Split equally, by item, or by custom percentage across your group.
- **Price Compass** — Compare your exact cart across 10 DMV stores (Aldi, Walmart, Whole Foods, Target, Giant, Safeway, Trader Joe's, Costco, Lidl, H Mart) and see where you could have saved.
- **Analytics** — Track your spending by category, group, and month with AI-powered insights.
- **Smart Recommendations** — Personalized tips based on your actual spending patterns.
- **Groups** — Create groups with friends, manage shared expenses, and track who owes what.

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile Frontend | React Native + Expo SDK 54 (TypeScript) |
| Navigation | expo-router |
| Backend | Python 3.12 + FastAPI + Uvicorn |
| Database & Auth | Supabase (PostgreSQL + Row Level Security) |
| AI Model | Groq — Meta LLaMA 4 Scout 17B (vision + text) |
| Image Processing | Pillow (server-side resize before AI) |
| Grocery Prices | Kroger Product API (OAuth2) |
| Price Index | Custom DMV store index (10 stores) |

---

## 🏗 Architecture

```
📱 Expo App (iOS/Android)
        │
        ├── REST API (HTTP/JSON) ──► 🐍 FastAPI Backend (Mac :8000)
        │                                    │
        │                                    ├── 🤖 Groq AI (receipt OCR + categorization)
        │                                    ├── 🏪 Kroger API (live prices)
        │                                    └── 📊 DMV Price Index (10 stores)
        │
        └── Supabase SDK (direct) ──► 🗄 Supabase (PostgreSQL + Auth)
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Python 3.12+
- Expo Go app on your phone
- API keys (see below)

### 1. Clone the repo

```bash
git clone https://github.com/dhatrija6753/Data-Science-Capstone.git
cd Data-Science-Capstone
```

### 2. Install frontend dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env` file in the root directory:

```env
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
EXPO_PUBLIC_API_URL=http://YOUR_MAC_IP:8000
```

Find your Mac's IP with:
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

### 4. Set up the backend

```bash
cd backend
pip install -r requirements.txt
```

Create a `backend/.env` file:

```env
GROQ_API_KEY=your_groq_api_key
KROGER_CLIENT_ID=your_kroger_client_id
KROGER_CLIENT_SECRET=your_kroger_client_secret
```

### 5. Start the backend

```bash
cd backend
./start.sh
```

Or manually:
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 6. Start the frontend

```bash
npx expo start
```

Scan the QR code with Expo Go on your phone. Make sure your phone and Mac are on the same WiFi network.

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/ocr/scan-receipt` | Receipt image → extracted items |
| `POST` | `/categorize` | Item names → categories |
| `POST` | `/compare-prices` | Cart → store price rankings |
| `POST` | `/scan-and-compare` | All-in-one scan + compare |

---

## 🗄 Database Schema

```
users           → id, email, display_name
groups          → id, name, created_by
group_members   → group_id, user_id, role
bills           → id, group_id, store_name, total_amount, bill_date
bill_items      → id, bill_id, name, quantity, unit_price, total_price, category
bill_splits     → id, bill_id, user_id, amount_owed
```

---

## 🤖 How AI Works

1. User takes a receipt photo → Expo compresses it to 30% quality
2. Backend receives base64 image → Pillow resizes to max 640px
3. Groq's **LLaMA 4 Scout** vision model reads the receipt → returns structured JSON
4. Same model categorizes each item (produce, dairy, household, etc.)
5. Backend compares prices across all 10 DMV stores
6. App displays results with savings breakdown

---

## 🏪 Supported DMV Stores

Aldi · Walmart · Target · Whole Foods · Giant Food · Safeway · Trader Joe's · Costco · Lidl · H Mart · Kroger (live prices)

---

## 👥 Team

Built as a Data Science Capstone project at George Mason University.

---

## 📄 License

MIT
