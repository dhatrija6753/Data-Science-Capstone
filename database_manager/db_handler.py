import sqlite3
import pandas as pd

def init_db():
    conn = sqlite3.connect('smart_splitwise.db')
    cursor = conn.cursor()
    
    # Table to store every item from every scanned receipt
    cursor.execute('''CREATE TABLE IF NOT EXISTS purchase_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        item_name TEXT,
                        price REAL,
                        store TEXT,
                        date TEXT
                    )''')
    
    # Table to store prices you find from the web/Walmart API
    cursor.execute('''CREATE TABLE IF NOT EXISTS store_prices (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        item_name TEXT,
                        price REAL,
                        store_name TEXT,
                        last_updated TEXT
                    )''')
    conn.commit()
    conn.close()
    print("Database initialized!")

if __name__ == "__main__":
    init_db()

def get_recommendations():
    conn = sqlite3.connect('smart_splitwise.db')
    
    # 1. Pull the history into Pandas
    df = pd.read_sql_query("SELECT item_name, price FROM purchase_history", conn)
    
    # 2. Find the top 5 most frequent items
    top_items = df['item_name'].value_counts().head(5).index.tolist()
    
    # 3. Reference live 2026 data (Simulation based on current market)
    live_prices = {
        "Milk": 2.92,
        "Eggs": 2.92,
        "Bread": 1.48,
        "Bananas": 0.20,
        "Chicken": 11.57
    }
    
    recommendations = []
    for item in top_items:
        avg_price = df[df['item_name'] == item]['price'].mean()
        # Find matches for live pricing (simple keyword check)
        current_price = next((v for k, v in live_prices.items() if k.lower() in item.lower()), "N/A")
        
        recommendations.append({
            "item": item,
            "avg_spent": round(avg_price, 2),
            "current_market": current_price
        })
    
    conn.close()
    return recommendations

if __name__ == "__main__":
    # If the database doesn't exist yet, this sets it up
    init_db() 
    
    # Run the recommender
    print("\n--- Smart Splitwise: February 2026 Recommendations ---")
    suggestions = get_recommendations()
    for s in suggestions:
        diff = ""
        if isinstance(s['current_market'], float):
            savings = round(s['avg_spent'] - s['current_market'], 2)
            diff = f"| Potential Savings: ${savings}" if savings > 0 else ""
            
        print(f"Item: {s['item']:<20} | History Avg: ${s['avg_spent']:<5} {diff}")

    