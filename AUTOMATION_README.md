# DANA Movilidad Website Automation

This project contains a Jupyter notebook that automates interaction with the DANA Movilidad FME Server application.

## Files

- `dana_movilidad_automation.ipynb` - Main automation notebook
- `requirements.txt` - Python dependencies

## What it does

The notebook automates the following tasks on https://fme.conterra.de/fmeserver/apps/DANAMovilidad:

1. **Set a sample date** - Automatically fills in a date field with a recent date (7 days ago)
2. **Select Excel format** - Finds and selects Excel as the output format
3. **Click the Run button** - Executes the process

## Quick Start

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Install ChromeDriver:
   ```bash
   # On Ubuntu/Debian
   sudo apt-get install chromium-chromedriver
   
   # Or using webdriver-manager (recommended)
   pip install webdriver-manager
   ```

3. Open the notebook:
   ```bash
   jupyter notebook dana_movilidad_automation.ipynb
   ```

4. Run the cells in order

## Features

- **Robust element detection** - Uses multiple CSS selectors and XPath expressions to find form elements
- **Error handling** - Gracefully handles missing elements or connection issues
- **Manual inspection mode** - If automation fails, you can inspect page elements to debug
- **Flexible date setting** - Easy to customize the sample date
- **Browser options** - Can run in headless mode or with full browser window

## Troubleshooting

If the automation doesn't work immediately:

1. Use the "Manual Inspection" cell to see all available form elements
2. Check if the website structure has changed
3. Adjust the CSS selectors or XPath expressions as needed
4. Ensure ChromeDriver is properly installed and in your PATH

## Notes

- The automation is designed to be robust but may need adjustments if the website changes
- For headless operation, uncomment the `--headless` option in the Chrome driver setup
- The script waits for elements to load and includes proper error handling