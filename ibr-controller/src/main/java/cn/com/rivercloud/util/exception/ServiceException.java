package cn.com.rivercloud.util.exception;

public class ServiceException extends RuntimeException {

	private static final long serialVersionUID = 1L;

	/* 错误码，默认为0 */
	private String errCode;

	private String errMsg;

	public ServiceException() {
		super();
	}

	public ServiceException(String detail) {
		super(detail);
	}

	public ServiceException(String message, Throwable cause) {
		super(message, cause);
	}
	public ServiceException(String errCode, String message, Throwable cause) {
		super(message, cause);
		this.setErrCode(errCode);
	}

	public ServiceException(Throwable cause) {
		super(cause);
	}


	public ServiceException(String errCode, String message) {
		super(message);
		this.setErrCode(errCode);
	}

	public String getErrMsg() {
		return errMsg;
	}

	public void setErrMsg(String errMsg) {
		this.errMsg = errMsg;
	}

	public String getErrCode() {
		return errCode;
	}

	public void setErrCode(String errCode) {
		this.errCode = errCode;
	}
}
