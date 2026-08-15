#!/usr/bin/env python3
"""
Test feature extraction for RNNoise paper implementation.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import torch
from rnnoise.src.utils import extract_features, vorbis_window

def test_feature_extraction():
    """Test that feature extraction runs without errors."""
    print("Testing feature extraction...")

    # Create synthetic audio (1 second of 48 kHz sine wave)
    sampling_rate = 48000
    duration = 1.0  # seconds
    freq = 440.0  # Hz
    t = torch.linspace(0, duration, int(sampling_rate * duration))
    audio = torch.sin(2 * torch.pi * freq * t)

    # Add batch dimension
    audio = audio.unsqueeze(0)  # (1, 48000)

    print(f"Audio shape: {audio.shape}")

    # Extract features
    try:
        features = extract_features(
            audio,
            sampling_rate=sampling_rate,
            frame_size=960,
            hop_size=480,
            device="cpu"
        )
        print(f"Success! Features shape: {features.shape}")
        print(f"Expected: (batch, n_frames, 42), got: {features.shape}")

        # Check dimensions
        batch, n_frames, n_features = features.shape
        assert n_features == 42, f"Expected 42 features, got {n_features}"
        print(f"Number of frames: {n_frames}")

        # Check for NaN or Inf
        assert not torch.isnan(features).any(), "Features contain NaN"
        assert not torch.isinf(features).any(), "Features contain Inf"
        print("No NaN or Inf values detected.")

        # Print first frame features summary
        print("\nFirst frame features (first 10 values):")
        print(features[0, 0, :10])

        return True

    except Exception as e:
        print(f"Error during feature extraction: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_feature_extraction()
    sys.exit(0 if success else 1)