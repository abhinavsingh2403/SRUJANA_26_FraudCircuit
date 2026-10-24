import unittest

from traceguard.config import Settings
from traceguard.ingestion import CSVValidationError, parse_csv_bytes

VALID = b"""transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type
T1,2026-10-24T09:00:00Z,A,B,12.50,TRANSFER
T2,2026-10-24T09:01:00+05:30,C,D,25,TRANSFER
"""


class IngestionTests(unittest.TestCase):
    def test_excessive_column_count_rejected(self):
        settings = Settings(max_csv_columns=8)
        raw = b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type,extra_a,extra_b,extra_c\n"
        with self.assertRaises(CSVValidationError) as ctx:
            parse_csv_bytes(raw, settings)
        self.assertIn("column limit", str(ctx.exception))

    def test_duplicate_headers_rejected_after_normalization(self):
        raw = b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type, Amount \nT1,2026-10-24T09:00:00Z,A,B,12,TRANSFER,99\n"
        with self.assertRaises(CSVValidationError) as ctx:
            parse_csv_bytes(raw)
        self.assertIn("duplicate column names", str(ctx.exception))

    def test_valid_csv_and_timezone_normalization(self):
        result = parse_csv_bytes(VALID)
        self.assertEqual(result.row_count, 2)
        tx_by_id = {tx.transaction_id: tx for tx in result.transactions}
        self.assertIn("T1", tx_by_id)
        self.assertTrue(tx_by_id["T2"].timestamp.endswith("Z"))
        self.assertTrue(tx_by_id["T2"].timestamp.startswith("2026-10-24T03:31:00"))
        self.assertTrue(any("one ledger" in warning for warning in result.warnings))

    def test_label_flag_and_balance_columns_are_excluded(self):
        raw = (b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type,isFraud,isFlaggedFraud,oldbalanceOrg\n"
               b"T1,2026-10-24T09:00:00Z,A,B,12,TRANSFER,1,1,0\n")
        result = parse_csv_bytes(raw)
        self.assertEqual(result.transactions[0].transaction_id, "T1")
        self.assertIn("isFraud", result.dropped_columns)
        self.assertIn("isFlaggedFraud", result.dropped_columns)
        self.assertIn("oldbalanceOrg", result.dropped_columns)
        self.assertNotIn("isFraud", result.transactions[0].public_dict())


    def test_microsecond_timestamp_is_preserved(self):
        raw = b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type\nT1,2026-10-24T09:00:00.123456Z,A,B,1,TRANSFER\n"
        result = parse_csv_bytes(raw)
        self.assertTrue(result.transactions[0].timestamp.endswith("00.123456Z"))

    def test_timezone_required(self):
        raw = b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type\nT1,2026-10-24T09:00:00,A,B,12,TRANSFER\n"
        with self.assertRaises(CSVValidationError) as ctx:
            parse_csv_bytes(raw)
        self.assertIn("timezone", str(ctx.exception.details[0]["error"]))

    def test_non_positive_amount_rejected(self):
        raw = b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type\nT1,2026-10-24T09:00:00Z,A,B,0,TRANSFER\n"
        with self.assertRaises(CSVValidationError):
            parse_csv_bytes(raw)

    def test_non_finite_amount_rejected(self):
        raw = b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type\nT1,2026-10-24T09:00:00Z,A,B,nan,TRANSFER\n"
        with self.assertRaises(CSVValidationError):
            parse_csv_bytes(raw)

    def test_duplicate_transaction_ids_rejected(self):
        raw = b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type\nT1,2026-10-24T09:00:00Z,A,B,1,TRANSFER\nT1,2026-10-24T09:01:00Z,A,C,2,TRANSFER\n"
        with self.assertRaises(CSVValidationError) as ctx:
            parse_csv_bytes(raw)
        self.assertIn("duplicate transaction_id", str(ctx.exception.details))

    def test_paysim_direct_upload_is_rejected_with_adapter_guidance(self):
        raw = b"step,type,amount,nameOrig,nameDest,isFraud\n1,TRANSFER,1,A,B,0\n"
        with self.assertRaises(CSVValidationError) as ctx:
            parse_csv_bytes(raw)
        self.assertIn("PaySim-style", str(ctx.exception))

    def test_unknown_columns_ignored_and_reported(self):
        raw = b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type,device_id\nT1,2026-10-24T09:00:00Z,A,B,1,TRANSFER,abc\n"
        result = parse_csv_bytes(raw)
        self.assertIn("device_id", result.dropped_columns)
        self.assertTrue(any("unsupported columns" in warning for warning in result.warnings))


    def test_single_currency_is_preserved(self):
        raw = b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type,currency\nT1,2026-10-24T09:00:00Z,A,B,12,TRANSFER,INR\n"
        result = parse_csv_bytes(raw)
        self.assertEqual(result.currency, "INR")
        self.assertEqual(result.transactions[0].public_dict()["currency"], "INR")

    def test_mixed_currencies_are_rejected(self):
        raw = b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type,currency\nT1,2026-10-24T09:00:00Z,A,B,12,TRANSFER,INR\nT2,2026-10-24T09:01:00Z,A,C,12,TRANSFER,USD\n"
        with self.assertRaises(CSVValidationError) as ctx:
            parse_csv_bytes(raw)
        self.assertIn("Multiple currencies", str(ctx.exception))


    def test_amount_numeric_safety_limit(self):
        settings = Settings(max_transaction_amount=1000)
        raw = b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type\nT1,2026-10-24T09:00:00Z,A,B,1001,TRANSFER\n"
        with self.assertRaises(CSVValidationError) as ctx:
            parse_csv_bytes(raw, settings)
        self.assertIn("numeric safety limit", str(ctx.exception.details))


    def test_extra_fields_in_row_rejected(self):
        raw = b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type\nT1,2026-10-24T09:00:00Z,A,B,1,TRANSFER,EXTRA\n"
        with self.assertRaises(CSVValidationError) as ctx:
            parse_csv_bytes(raw)
        self.assertIn("more values than the header", str(ctx.exception.details))

    def test_row_limit_rejected(self):
        settings = Settings(max_csv_rows=2)
        raw = (b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type\n"
               b"T1,2026-10-24T09:00:00Z,A,B,1,TRANSFER\n"
               b"T2,2026-10-24T09:01:00Z,C,D,2,TRANSFER\n"
               b"T3,2026-10-24T09:02:00Z,E,F,3,TRANSFER\n")
        with self.assertRaises(CSVValidationError) as ctx:
            parse_csv_bytes(raw, settings)
        self.assertIn("row limit", str(ctx.exception))

    def test_upload_size_limit(self):
        settings = Settings(max_upload_bytes=10)
        with self.assertRaises(CSVValidationError):
            parse_csv_bytes(VALID, settings)

    def test_empty_body_rejected(self):
        with self.assertRaises(CSVValidationError):
            parse_csv_bytes(b"")


    def test_self_transfer_rejected(self):
        raw = b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type\nT1,2026-10-24T09:00:00Z,A,A,1,TRANSFER\n"
        with self.assertRaises(CSVValidationError) as ctx:
            parse_csv_bytes(raw)
        self.assertIn("must differ", str(ctx.exception.details))

    def test_control_characters_rejected_in_ids(self):
        raw = b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type\nT1,2026-10-24T09:00:00Z,A\tB,C,1,TRANSFER\n"
        with self.assertRaises(CSVValidationError) as ctx:
            parse_csv_bytes(raw)
        self.assertIn("control character", str(ctx.exception.details))

    def test_oversized_csv_field_returns_validation_error_not_uncaught_csv_error(self):
        # Under the overall byte limit but above Python's default csv field-size limit.
        huge_id = b"A" * 200_000
        raw = (b"transaction_id,timestamp,sender_id,recipient_id,amount,transaction_type\n" +
               huge_id + b",2026-10-24T09:00:00Z,A,B,1,TRANSFER\n")
        with self.assertRaises(CSVValidationError):
            parse_csv_bytes(raw)

if __name__ == "__main__":
    unittest.main()
