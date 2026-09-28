import json
import os
from datetime import datetime, timezone, timedelta
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

WIB = timezone(timedelta(hours=7))

def parse_wib(iso_str):
    if not iso_str:
        return '', ''
    try:
        dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
        dt_wib = dt.astimezone(WIB)
        return dt_wib.strftime('%d/%m/%Y'), dt_wib.strftime('%H:%M')
    except Exception:
        return iso_str[:10], iso_str[11:16]

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ORDERS_FILE = os.path.join(BASE_DIR, 'data', 'orders.json')
OUTPUT_FILE = os.path.join(BASE_DIR, 'laporan-penjualan-chewys.xlsx')

def generate_excel():
    orders = []
    if os.path.exists(ORDERS_FILE):
        try:
            with open(ORDERS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                orders = data.get('orders', [])
        except Exception as e:
            print(f"Error reading orders: {e}")

    # Create Workbook
    wb = openpyxl.Workbook()
    
    # -------------------------------------------------------------
    # SHEET 1: LAPORAN TRANSAKSI
    # -------------------------------------------------------------
    ws1 = wb.active
    ws1.title = "Laporan Transaksi"
    ws1.views.sheetView[0].showGridLines = True

    # Styles
    title_font = Font(name="Calibri", size=16, bold=True, color="2D1406")
    subtitle_font = Font(name="Calibri", size=10, italic=True, color="78716C")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="FE6134", end_color="FE6134", fill_type="solid")
    
    total_font = Font(name="Calibri", size=11, bold=True, color="2D1406")
    total_fill = PatternFill(start_color="F7F6E2", end_color="F7F6E2", fill_type="solid")
    
    zebra_fill = PatternFill(start_color="FFFDF9", end_color="FFFDF9", fill_type="solid")
    
    thin_border = Border(
        left=Side(style='thin', color='D6D3D1'),
        right=Side(style='thin', color='D6D3D1'),
        top=Side(style='thin', color='D6D3D1'),
        bottom=Side(style='thin', color='D6D3D1')
    )
    double_bottom_border = Border(
        left=Side(style='thin', color='D6D3D1'),
        right=Side(style='thin', color='D6D3D1'),
        top=Side(style='thin', color='D6D3D1'),
        bottom=Side(style='double', color='2D1406')
    )

    # Title Block
    ws1.merge_cells('A1:L1')
    ws1['A1'] = "CHEWY'S DESSERT & COFFEE — LAPORAN PENJUALAN"
    ws1['A1'].font = title_font
    ws1['A1'].alignment = Alignment(vertical="center")
    ws1.row_dimensions[1].height = 28

    ws1.merge_cells('A2:L2')
    ws1['A2'] = f"Status: Laporan Resmi Toko · Diperbarui secara otomatis"
    ws1['A2'].font = subtitle_font
    ws1['A2'].alignment = Alignment(vertical="center")
    ws1.row_dimensions[2].height = 18

    # Empty row 3
    ws1.row_dimensions[3].height = 8

    # Headers
    headers = [
        "No", "No. Struk", "Tanggal", "Waktu", "Kasir", 
        "Tipe Pesanan", "Meja / Pelanggan", "Menu Dipesan", 
        "Subtotal (Rp)", "Diskon (Rp)", "Total Bayar (Rp)", "Metode Bayar", "Status"
    ]
    
    header_row = 4
    ws1.row_dimensions[header_row].height = 26
    
    for col_num, header in enumerate(headers, 1):
        cell = ws1.cell(row=header_row, column=col_num, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border

    # Data Rows
    current_row = 5
    total_revenue = 0
    total_discount = 0
    total_subtotal = 0

    if not orders:
        # Sample placeholder if no orders yet
        orders_to_render = [
            {
                "id": "CWY-CONTOH-0001",
                "createdAt": "2026-09-29T10:30:00.000Z",
                "cashier": "Kasir 1",
                "orderType": "dine-in",
                "tableOrCustomer": "Meja 04",
                "items": [{"name": "Brulee Baby", "qty": 2}, {"name": "OG Choc Chip Cookie", "qty": 1}],
                "subtotal": 81000,
                "discount": 0,
                "total": 81000,
                "paymentMethod": "qris",
                "status": "completed"
            },
            {
                "id": "CWY-CONTOH-0002",
                "createdAt": "2026-09-29T11:15:00.000Z",
                "cashier": "Kasir 1",
                "orderType": "takeaway",
                "tableOrCustomer": "Kak Sarah",
                "items": [{"name": "The Original Brookie", "qty": 1}, {"name": "Kopi Gula Aren", "qty": 1}],
                "subtotal": 63000,
                "discount": 5000,
                "total": 58000,
                "paymentMethod": "cash",
                "status": "completed"
            }
        ]
    else:
        orders_to_render = orders

    for idx, order in enumerate(orders_to_render, 1):
        created = order.get('createdAt', '')
        date_str, time_str = parse_wib(created)

        items_text = ", ".join([f"{it.get('name', 'Menu')} ({it.get('qty', 1)}x)" for it in order.get('items', [])])
        subtotal = int(order.get('subtotal', 0))
        discount = int(order.get('discount', 0))
        total = int(order.get('total', 0))

        total_subtotal += subtotal
        total_discount += discount
        total_revenue += total

        row_data = [
            idx,
            order.get('id', f'CWY-{idx}'),
            date_str,
            time_str,
            order.get('cashier', 'Kasir 1'),
            order.get('orderType', 'dine-in').upper(),
            order.get('tableOrCustomer', '-'),
            items_text,
            subtotal,
            discount,
            total,
            order.get('paymentMethod', 'cash').upper(),
            "LUNAS"
        ]

        ws1.row_dimensions[current_row].height = 22
        for col_num, val in enumerate(row_data, 1):
            cell = ws1.cell(row=current_row, column=col_num, value=val)
            cell.border = thin_border
            cell.font = Font(name="Calibri", size=10)

            # Alignment & formatting
            if col_num in [1, 3, 4, 6, 12, 13]:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            elif col_num in [9, 10, 11]:
                cell.alignment = Alignment(horizontal="right", vertical="center")
                cell.number_format = '#,##0'
                if col_num == 11:
                    cell.font = Font(name="Calibri", size=10, bold=True, color="C2410C")
            else:
                cell.alignment = Alignment(horizontal="left", vertical="center")

            # Alternate row background
            if idx % 2 == 0:
                cell.fill = zebra_fill

        current_row += 1

    # Total Summary Row
    ws1.row_dimensions[current_row].height = 26
    ws1.merge_cells(start_row=current_row, start_column=1, end_row=current_row, end_column=8)
    total_label = ws1.cell(row=current_row, column=1, value="TOTAL KESELURUHAN PENJUALAN:")
    total_label.font = total_font
    total_label.fill = total_fill
    total_label.alignment = Alignment(horizontal="right", vertical="center")

    for col in range(1, 9):
        ws1.cell(row=current_row, column=col).border = double_bottom_border
        ws1.cell(row=current_row, column=col).fill = total_fill

    # Subtotal sum
    cell_sub = ws1.cell(row=current_row, column=9, value=total_subtotal)
    cell_sub.font = total_font
    cell_sub.fill = total_fill
    cell_sub.border = double_bottom_border
    cell_sub.number_format = '#,##0'
    cell_sub.alignment = Alignment(horizontal="right", vertical="center")

    # Discount sum
    cell_disc = ws1.cell(row=current_row, column=10, value=total_discount)
    cell_disc.font = total_font
    cell_disc.fill = total_fill
    cell_disc.border = double_bottom_border
    cell_disc.number_format = '#,##0'
    cell_disc.alignment = Alignment(horizontal="right", vertical="center")

    # Grand total sum
    cell_tot = ws1.cell(row=current_row, column=11, value=total_revenue)
    cell_tot.font = Font(name="Calibri", size=11, bold=True, color="C2410C")
    cell_tot.fill = total_fill
    cell_tot.border = double_bottom_border
    cell_tot.number_format = '#,##0'
    cell_tot.alignment = Alignment(horizontal="right", vertical="center")

    for col in [12, 13]:
        c = ws1.cell(row=current_row, column=col, value="")
        c.fill = total_fill
        c.border = double_bottom_border

    # Auto-fit Column Widths with padding
    for col in ws1.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            # Skip title row from width calculation
            if cell.row in [1, 2]:
                continue
            if cell.value:
                val_str = str(cell.value)
                max_len = max(max_len, len(val_str))
        ws1.column_dimensions[col_letter].width = max(max_len + 4, 12)

    ws1.column_dimensions['A'].width = 6   # No
    ws1.column_dimensions['B'].width = 20  # No Struk
    ws1.column_dimensions['G'].width = 18  # Meja
    ws1.column_dimensions['H'].width = 38  # Menu Dipesan
    ws1.column_dimensions['I'].width = 16  # Subtotal
    ws1.column_dimensions['J'].width = 14  # Diskon
    ws1.column_dimensions['K'].width = 18  # Total

    # -------------------------------------------------------------
    # SHEET 2: REKAP METODE BAYAR & PRODUK
    # -------------------------------------------------------------
    ws2 = wb.create_sheet(title="Ringkasan Eksekutif")
    ws2.views.sheetView[0].showGridLines = True

    ws2['A1'] = "RINGKASAN METODE PEMBAYARAN"
    ws2['A1'].font = Font(name="Calibri", size=13, bold=True, color="2D1406")
    
    ws2['A3'] = "Metode Pembayaran"
    ws2['B3'] = "Total Transaksi"
    ws2['C3'] = "Total Omset (Rp)"
    for col_idx, col_name in enumerate(['A3', 'B3', 'C3']):
        c = ws2[col_name]
        c.font = header_font
        c.fill = header_fill
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = thin_border

    pm_stats = {"CASH": 0, "QRIS": 0, "EDC": 0}
    pm_counts = {"CASH": 0, "QRIS": 0, "EDC": 0}
    for o in orders_to_render:
        pm = (o.get('paymentMethod') or 'CASH').upper()
        if pm not in pm_stats:
            pm_stats[pm] = 0
            pm_counts[pm] = 0
        pm_stats[pm] += int(o.get('total', 0))
        pm_counts[pm] += 1

    r = 4
    for pm, amt in pm_stats.items():
        ws2.cell(row=r, column=1, value=pm).border = thin_border
        ws2.cell(row=r, column=2, value=pm_counts[pm]).border = thin_border
        amt_cell = ws2.cell(row=r, column=3, value=amt)
        amt_cell.border = thin_border
        amt_cell.number_format = '#,##0'
        r += 1

    ws2.column_dimensions['A'].width = 24
    ws2.column_dimensions['B'].width = 18
    ws2.column_dimensions['C'].width = 22

    # Save to file (safe against open file lock in Excel)
    target_path = OUTPUT_FILE
    try:
        wb.save(OUTPUT_FILE)
    except PermissionError:
        target_path = os.path.join(BASE_DIR, 'laporan-penjualan-chewys-export.xlsx')
        wb.save(target_path)
    print(target_path)
    return target_path

if __name__ == '__main__':
    generate_excel()
