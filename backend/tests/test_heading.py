import json
import pytest
from app.services.heading import _bearing_degrees, _decode_position


class TestBearingDegrees:
    def test_north(self):
        result = _bearing_degrees(0, 0, 1, 0)
        assert result == pytest.approx(0.0, abs=0.1)

    def test_east(self):
        result = _bearing_degrees(0, 0, 0, 1)
        assert result == pytest.approx(90.0, abs=0.1)

    def test_south(self):
        result = _bearing_degrees(1, 0, 0, 0)
        assert result == pytest.approx(180.0, abs=0.1)

    def test_west(self):
        result = _bearing_degrees(0, 1, 0, 0)
        assert result == pytest.approx(270.0, abs=0.1)

    def test_same_position_returns_none(self):
        assert _bearing_degrees(10.0, 20.0, 10.0, 20.0) is None

    def test_result_in_range(self):
        result = _bearing_degrees(51.5, -0.1, 48.8, 2.3)
        assert result is not None
        assert 0.0 <= result < 360.0


class TestDecodePosition:
    def test_valid_payload(self):
        raw = json.dumps({"lat": 51.5, "lon": -0.1})
        assert _decode_position(raw) == (51.5, -0.1)

    def test_none_input(self):
        assert _decode_position(None) is None

    def test_empty_string(self):
        assert _decode_position("") is None

    def test_invalid_json(self):
        assert _decode_position("not-json") is None

    def test_missing_keys(self):
        assert _decode_position(json.dumps({"lat": 1.0})) is None

    def test_non_numeric_values(self):
        assert _decode_position(json.dumps({"lat": "bad", "lon": 0.0})) is None
