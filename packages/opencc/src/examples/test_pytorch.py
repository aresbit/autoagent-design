#!/usr/bin/env python3
"""测试PyTorch环境"""

import torch
import torchvision
import sys

print(f"Python版本: {sys.version}")
print(f"PyTorch版本: {torch.__version__}")
print(f"Torchvision版本: {torchvision.__version__}")
print(f"CUDA可用: {torch.cuda.is_available()}")

if torch.cuda.is_available():
    print(f"CUDA版本: {torch.version.cuda}")
    print(f"GPU设备: {torch.cuda.get_device_name(0)}")
else:
    print("使用CPU版本")

# 简单的张量操作测试
x = torch.tensor([1.0, 2.0, 3.0])
y = torch.tensor([4.0, 5.0, 6.0])
z = x + y
print(f"\n张量操作测试: {x} + {y} = {z}")

# 简单的神经网络测试
model = torch.nn.Linear(10, 5)
input_tensor = torch.randn(3, 10)
output = model(input_tensor)
print(f"\n神经网络测试: 输入形状 {input_tensor.shape} -> 输出形状 {output.shape}")

print("\nPyTorch环境测试通过！")