Data Science Capstone Project: Smart Splitwise Assistant

Problem Addressed
Many international students in the USA struggle to manually track and split grocery bills. 
This project automates bill tracking and predicts next month’s grocery needs while 
suggesting nearby stores with low prices.

Proposed Solution
- Users upload a photo of the bill.
- OCR extracts item details from the bill.
- Bills are split automatically among group members.
- A recommendation engine suggests next month’s groceries based on:
    - Item purchase frequency
    - Nearby store prices (scraped from online sources)
- Web-based interface allows easy interaction and visualization.

Tech Stack
- Python 3.x
- Flask (Web app)
- OpenCV / Tesseract (OCR)
- Pandas / Numpy (Data processing)
- BeautifulSoup / Requests (Web scraping)
- SQLite / CSV (Data storage)
- Git (Version control)



