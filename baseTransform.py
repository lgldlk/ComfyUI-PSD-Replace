import torch
import numpy as np
from PIL import Image
import io
import base64
from torchvision import transforms

def tensor_to_base64(tensor, batch_index=0):
    """
    Convert PyTorch tensor [B, H, W, C] to base64 using torchvision
    
    Args:
        tensor (torch.Tensor): Input tensor [B, H, W, C]
        batch_index (int): Batch index to convert
    
    Returns:
        str: Base64 encoded string
    """
    if tensor.dim() != 4:
        raise ValueError(f"Expected 4D tensor [B, H, W, C], got {tensor.shape}")
    if batch_index >= tensor.shape[0]:
        raise ValueError(f"Batch index {batch_index} out of range")

    img_tensor = tensor[batch_index].permute(2, 0, 1)
    img_tensor = img_tensor * 255
    img_tensor = torch.clamp(img_tensor, 0, 255).to(torch.uint8)
    
    to_pil = transforms.ToPILImage()
    img = to_pil(img_tensor.cpu())

    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    base64_str = base64.b64encode(buffer.getvalue()).decode('utf-8')
    
    return base64_str


def base64_to_tensor(base64_str, batch_size=1, normalize=True):
    """
    Convert base64 string to PyTorch tensor [B, H, W, C] using torchvision
    
    Args:
        base64_str (str): Base64 encoded image string
        batch_size (int): Desired batch size
        normalize (bool): Whether to normalize to [0,1] (True) or keep [0,255] (False)
    
    Returns:
        torch.Tensor: Tensor with shape [B, H, W, C]
    """
    # Decode base64 to bytes
    img_bytes = base64.b64decode(base64_str)
    
    # Open as PIL Image and convert to RGB
    img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
    
    # Define transformation
    transform_list = [transforms.ToTensor()]  # Converts to [C, H, W], normalized to [0,1]
    if not normalize:
        transform_list.append(transforms.Lambda(lambda x: x * 255))
    
    transform = transforms.Compose(transform_list)
    
    # Convert to tensor and reshape
    tensor = transform(img)  # [C, H, W]
    tensor = tensor.permute(1, 2, 0)  # [H, W, C]
    tensor = tensor.unsqueeze(0)  # [1, H, W, C]
    
    # Repeat for batch size if needed
    if batch_size > 1:
        tensor = tensor.repeat(batch_size, 1, 1, 1)
    
    return tensor