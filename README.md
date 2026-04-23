SplitSmart

Scan. Split. Save. — A smart grocery bill splitter for DMV-area students.

SplitSmart allows users to photograph a grocery receipt, automatically extract all line items using AI, split the bill with friends, and compare prices across stores to identify savings opportunities.



Features

- Receipt scanning using AI to extract items, prices, tax, and totals
- Flexible bill splitting (equal, by item, or custom percentage)
- Price comparison across multiple DMV-area grocery stores
- Spending analytics by category, group, and time
- Personalized recommendations based on spending patterns
- Group management and shared expense tracking



Tech Stack

Layer | Technology
------|-----------
Mobile Frontend | React Native, Expo SDK 54, TypeScript
Navigation | Expo Router
Backend | Python 3.12, FastAPI, Uvicorn
Database and Auth | Supabase (PostgreSQL with Row Level Security)
AI Model | Groq (Meta LLaMA 4 Scout 17B)
Image Processing | Pillow
Grocery Prices | Kroger Product API (OAuth2)
Price Engine | Custom DMV store index



Architecture

Mobile App (React Native)
        |
        |-- REST API --> FastAPI Backend
        |                    |
        |                    |-- Groq AI (OCR and categorization)
        |                    |-- Kroger API (live prices)
        |                    |-- Price index engine
        |
        |-- Supabase SDK --> Supabase (PostgreSQL and Authentication)

---

Getting Started

Prerequisites

- Node.js 18 or higher
- Python 3.12 or higher
- Expo Go app on mobile device
- Required API keys



1. Clone the repository

git clone https://github.com/dhatrija6753/Data-Science-Capstone.git  
cd Data-Science-Capstone



2. Install frontend dependencies

npm install



3. Configure environment variables

Create a .env file in the root directory:

EXPO_PUBLIC_SUPABASE_URL=your_supabase_url  
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key  
EXPO_PUBLIC_API_URL=http://YOUR_MAC_IP:8000  

Find your IP using:

ifconfig | grep "inet " | grep -v 127.0.0.1



4. Setup backend

cd backend  
pip install -r requirements.txt  

Create backend/.env:

GROQ_API_KEY=your_groq_api_key  
KROGER_CLIENT_ID=your_kroger_client_id  
KROGER_CLIENT_SECRET=your_kroger_client_secret  



5. Start backend

./start.sh  

Or:

uvicorn main:app --reload --host 0.0.0.0 --port 8000



6. Start frontend

npx expo start  

Scan the QR code using Expo Go. Ensure your device and computer are on the same network.



API Endpoints

Method | Endpoint | Description
-------|----------|-------------
GET | /health | Health check
POST | /ocr/scan-receipt | Extract receipt items
POST | /categorize | Categorize items
POST | /compare-prices | Compare store prices
POST | /scan-and-compare | Full pipeline


Database Schema

users → id, email, display_name  
groups → id, name, created_by  
group_members → group_id, user_id, role  
bills → id, group_id, store_name, total_amount, bill_date  
bill_items → id, bill_id, name, quantity, unit_price, total_price, category  
bill_splits → id, bill_id, user_id, amount_owed  



How AI Works

1. User captures a receipt image  
2. Backend resizes the image using Pillow  
3. Groq LLaMA model extracts structured data  
4. Items are categorized automatically  
5. Prices are compared across stores  
6. Results are returned with savings insights  



Supported Stores

Aldi, Walmart, Target, Whole Foods, Giant Food, Safeway, Trader Joe's, Costco, Lidl, H Mart, Kroger



Team

Built as a Data Science Capstone project.
Ayush Meshram, Dhatrija Sukasi, Trisha Singh.

---

## License

MIT License
