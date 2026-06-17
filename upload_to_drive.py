import os.path
import mimetypes
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

# If modifying these scopes, delete the file token.json.
# 'https://www.googleapis.com/auth/drive.file' allows uploading and creating/managing
# files that you create/open with this app.
SCOPES = ["https://www.googleapis.com/auth/drive.file"]


def get_credentials():
    """Gets valid user credentials from storage or runs the OAuth flow."""
    creds = None
    # The file token.json stores the user's access and refresh tokens, and is
    # created automatically when the authorization flow completes for the first time.
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    
    # If there are no (valid) credentials available, let the user log in.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists("credentials.json"):
                raise FileNotFoundError(
                    "credentials.json not found. Please download your OAuth desktop client ID JSON "
                    "from Google Cloud Console, rename it to credentials.json, and place "
                    "it in this folder."
                )
            flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
            creds = flow.run_local_server(port=0)
        
        # Save the credentials for the next run
        with open("token.json", "w") as token:
            token.write(creds.to_json())
            
    return creds


def upload_file(local_file_path, drive_folder_id=None):
    """Uploads a local file to Google Drive.
    
    Args:
        local_file_path (str): The path to the file on the local machine.
        drive_folder_id (str, optional): The ID of the Google Drive folder to upload to.
        
    Returns:
        str: The ID of the uploaded file, or None if the upload failed.
    """
    if not os.path.exists(local_file_path):
        print(f"Error: Local file '{local_file_path}' does not exist.")
        return None

    try:
        creds = get_credentials()
        service = build("drive", "v3", credentials=creds)

        # Get file name and detect MIME type
        file_name = os.path.basename(local_file_path)
        mime_type, _ = mimetypes.guess_type(local_file_path)
        if not mime_type:
            mime_type = "application/octet-stream"

        # Prepare file metadata
        file_metadata = {"name": file_name}
        if drive_folder_id:
            file_metadata["parents"] = [drive_folder_id]

        # Prepare media content
        media = MediaFileUpload(local_file_path, mimetype=mime_type, resumable=True)

        print(f"Uploading '{file_name}' ({mime_type}) to Google Drive...")
        
        # Execute the upload request
        file = (
            service.files()
            .create(body=file_metadata, media_body=media, fields="id, name")
            .execute()
        )

        print(f"Success! Uploaded File Name: {file.get('name')}")
        print(f"File ID: {file.get('id')}")
        return file.get("id")

    except HttpError as error:
        print(f"An API error occurred: {error}")
        return None
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return None


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python upload_to_drive.py <path_to_local_file> [drive_folder_id]")
        sys.exit(1)
        
    local_file = sys.argv[1]
    folder_id = sys.argv[2] if len(sys.argv) > 2 else None
    
    upload_file(local_file, folder_id)
