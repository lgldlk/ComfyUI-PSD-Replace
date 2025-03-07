
import folder_paths
import os
import subprocess
import json
from .baseTransform import tensor_to_base64, base64_to_tensor

class PSDProcessor:
    def __init__(self, node_script_path):
        """Initialize with path to Node.js script"""
        self.node_script_path = os.path.abspath(node_script_path)
        if not os.path.exists(self.node_script_path):
            raise FileNotFoundError(f"Node.js script not found at: {node_script_path}")

    def process_psd(self, psd_path, layer_name, base64_image):
        """
        Process PSD file with new image data using pipes
        
        Args:
            psd_path (str): Path to PSD file
            layer_name (str): Name of layer to replace
            image_path (str): Path to new image file
        
        Returns:
            bytes: Processed image data
        """
        try:
            # Prepare input data as JSON
            input_data = json.dumps({
                'psdPath': os.path.abspath(psd_path),
                'layerName': layer_name,
                'base64Image': base64_image
            }).encode('utf-8')

            # Execute Node.js script with pipes
            process = subprocess.Popen(
                ['node', self.node_script_path, '--pipe'],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=False  # Use bytes for binary data
            )

            # Communicate with the process
            stdout_data, stderr_data = process.communicate(input=input_data)
            
            # Check process exit code
            if process.returncode != 0:
                error_msg = stderr_data.decode('utf-8') if stderr_data else "Unknown error"
                raise RuntimeError(f"Node.js process failed with code {process.returncode}: {error_msg}")
            # Parse result
            result = json.loads(stdout_data.decode('utf-8'))
            if not result.get('success'):
                raise RuntimeError(f"Node.js processing failed: {result.get('error')}")

            return result['data']

        except subprocess.CalledProcessError as e:
            error_output = e.stderr.decode('utf-8') if e.stderr else str(e)
            raise RuntimeError(f"Node.js execution failed: {error_output}")
        except json.JSONDecodeError as e:
            raise RuntimeError("Failed to parse Node.js output",e)
        except Exception as e:
            raise RuntimeError(f"Processing error: {str(e)}")



class ReplacePSD:
  @classmethod
  def INPUT_TYPES(s):
    base_psd_dir = os.path.join(folder_paths.base_path, 'psd')
    
    # Ensure the directory exists, create it if it doesn't
    os.makedirs(base_psd_dir, exist_ok=True)
    
    # Get all PSD files, including those in subdirectories
    psd_files = []
    for root, dirs, files in os.walk(base_psd_dir):
        psd_files.extend([
            os.path.relpath(os.path.join(root, f), base_psd_dir) 
            for f in files 
            if f.lower().endswith('.psd')
        ])
    
    if not psd_files:
        psd_files = []
    return {
      "required": {
        "psd": (psd_files,),
        "image": ("IMAGE",),
        "layer_name": ("STRING", {"placeholder": "Layer Name"}),
      }
    }

  RETURN_TYPES = ("IMAGE",)
  FUNCTION = "replace_psd"
  CATEGORY = "image"

  def replace_psd(self, psd, image, layer_name):
    psd_path =os.path.join(os.path.join(folder_paths.base_path, 'psd'),psd)
    dir_path = os.path.dirname(os.path.abspath(__file__))
    node_script_path = os.path.join(dir_path, 'index.js')
    processor = PSDProcessor(node_script_path)
    base64_image=tensor_to_base64(image)


    base64_result = processor.process_psd(
            psd_path=psd_path,
            layer_name=layer_name,
            base64_image=base64_image
        )

    return (base64_to_tensor(base64_result),)


WEB_DIRECTORY = './plugins_js'
NODE_CLASS_MAPPINGS = {
    "psd replace": ReplacePSD
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "psd replace": "PSD Replace"
}
