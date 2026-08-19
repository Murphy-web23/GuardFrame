"""common/risk.py 的測試。純數學，不需要任何影格或模型。"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

from common import risk


def test_threshold_risk_at_threshold_is_half():
    assert risk.threshold_risk(3.0, 3.0, 1.0, higher_is_better=True) == pytest.approx(0.5)
    assert risk.threshold_risk(3.0, 3.0, 1.0, higher_is_better=False) == pytest.approx(0.5)


def test_threshold_risk_higher_is_better_low_value_is_high_risk():
    low_risk = risk.threshold_risk(10.0, 3.0, 1.0, higher_is_better=True)  # 遠高於門檻
    high_risk = risk.threshold_risk(-5.0, 3.0, 1.0, higher_is_better=True)  # 遠低於門檻
    assert low_risk < 0.1
    assert high_risk > 0.9


def test_threshold_risk_lower_is_better_low_value_is_low_risk():
    low_risk = risk.threshold_risk(0.01, 0.20, 0.05, higher_is_better=False)  # 遠低於門檻，安全
    high_risk = risk.threshold_risk(0.90, 0.20, 0.05, higher_is_better=False)  # 遠高於門檻，危險
    assert low_risk < 0.1
    assert high_risk > 0.9


def test_threshold_risk_monotonic_for_higher_is_better():
    values = [-2.0, 0.0, 2.0, 4.0, 6.0]
    risks = [risk.threshold_risk(v, 3.0, 1.5, higher_is_better=True) for v in values]
    assert risks == sorted(risks, reverse=True)  # value 越大，風險應該越低（遞減）


def test_threshold_risk_rejects_non_positive_scale():
    with pytest.raises(ValueError):
        risk.threshold_risk(1.0, 1.0, 0.0, higher_is_better=True)
    with pytest.raises(ValueError):
        risk.threshold_risk(1.0, 1.0, -1.0, higher_is_better=True)


def test_combine_risks_takes_maximum_not_average():
    assert risk.combine_risks(0.05, 0.05, 0.95) == pytest.approx(0.95)


def test_combine_risks_single_value():
    assert risk.combine_risks(0.42) == pytest.approx(0.42)


def test_combine_risks_empty_is_conservative_max():
    assert risk.combine_risks() == 1.0
