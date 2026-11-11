FROM python:3.10-slim

# Install system dependencies needed for openCV/PaddleOCR
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Force upgrading pip inside 3.10
RUN python3 -m pip install --upgrade pip

# Install PaddlePaddle explicitly for the container's Python 3.10 environment
RUN pip install paddlepaddle==2.6.1 -i https://tsinghua.edu.cn

# Install paddlehub and the OCR server components
RUN pip install paddlehub==2.1.0
RUN hub install ocr_system

EXPOSE 8866

CMD ["hub", "serving", "start", "-m", "ocr_system", "-p", "8866"]
