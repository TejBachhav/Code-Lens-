from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List

app = FastAPI()

class UserCreate(BaseModel):
    name: str
    email: str
    age: Optional[int] = None

class UserResponse(BaseModel):
    id: int
    name: str
    email: str

@app.get("/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: int):
    pass

@app.post("/users", response_model=UserResponse, status_code=201)
async def create_user(user: UserCreate):
    pass

@app.delete("/users/{user_id}")
async def delete_user(user_id: int):
    pass

@app.get("/users", response_model=List[UserResponse])
async def list_users(skip: int = 0, limit: int = 100):
    pass
